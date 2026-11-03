import fs from 'node:fs';
import path from 'node:path';
import {
  defaultInstallRoot,
  installedVersion,
  isWindowsX64,
  resolveAgentsDir,
  resolveConfigPath,
  resolveExe,
} from './paths.js';
import { readConfig } from './config.js';
import { AGENT_FILES, installedAgents } from './agents.js';
import { LABVIEW_PERMISSIONS } from './install.js';
import { bold, fail, listLabviewMcpProcesses, log, ok, run, step, warn } from './util.js';

function check(condition, good, bad) {
  if (condition) {
    log(`  ${ok('PASS')} ${good}`);
    return true;
  }
  log(`  ${fail('FAIL')} ${bad}`);
  return false;
}

function labviewInstallations() {
  const roots = [
    { dir: 'C:\\Program Files\\National Instruments', bitness: 'x64' },
    { dir: 'C:\\Program Files (x86)\\National Instruments', bitness: 'x86' },
  ];
  const found = [];
  for (const { dir, bitness } of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (/^LabVIEW\s+\d{4}/i.test(name)) found.push({ name, bitness, path: path.join(dir, name) });
    }
  }
  return found;
}

export function doctor(opts = {}) {
  const scope = opts.scope || 'user';
  const installRoot = path.resolve(opts.installRoot || defaultInstallRoot());
  const exe = opts.exe ? path.resolve(opts.exe) : resolveExe(installRoot);
  const config = resolveConfigPath(scope, opts.config);
  const agentsDir = resolveAgentsDir(scope, opts.agentsDir);
  let passed = 0;
  let failed = 0;
  const record = (v) => {
    if (v) passed += 1;
    else failed += 1;
  };

  step('Environment');
  record(check(isWindowsX64, `Windows x64 (${process.platform}/${process.arch})`, `unsupported platform ${process.platform}/${process.arch}`));
  record(check(Number(process.versions.node.split('.')[0]) >= 20, `Node ${process.versions.node}`, `Node ${process.versions.node} is too old (need >= 20)`));

  step('Binary');
  record(check(fs.existsSync(exe), exe, `missing: ${exe}`));
  if (fs.existsSync(exe)) {
    const version = installedVersion(installRoot);
    log(`  ${ok('INFO')} version: ${version || 'unknown'}`);
    const res = run(exe, ['--pylv-status'], { timeout: 120000 });
    record(check(res.status === 0, 'pylabview status answered', `--pylv-status exited ${res.status}`));
    if (res.stdout) {
      const lines = res.stdout.split(/\r?\n/).filter(Boolean).slice(0, 4);
      for (const line of lines) log(`       ${line}`);
    }
    if (opts.deep) {
      log('  running self-test...');
      const test = run(exe, ['--selftest'], { timeout: 180000 });
      record(check(test.status === 0, 'self-test passed', `self-test exited ${test.status}`));
      if (test.stdout) log(test.stdout.split(/\r?\n/).filter(Boolean).map((l) => `       ${l}`).join('\n'));
    }
  }

  step('LabVIEW');
  const installs = labviewInstallations();
  const labels = installs.map((p) => `${p.name} (${p.bitness})`);
  record(check(installs.length > 0, `found ${installs.length} installation(s): ${labels.join(', ')}`, 'no LabVIEW installation found in Program Files'));
  const processes = listLabviewMcpProcesses();
  log(`  ${ok('INFO')} LabVIEWMCP processes: ${processes.length}`);
  for (const p of processes) log(`       ${p.ProcessId}  ${p.ExecutablePath || ''}`);

  step('OpenCode config');
  record(check(fs.existsSync(config), config, `missing: ${config}`));
  if (fs.existsSync(config)) {
    try {
      const { data } = readConfig(config);
      const entry = data.mcp?.servers?.labview || data.mcp?.labview;
      record(check(Boolean(entry), 'mcp.servers.labview is registered', 'mcp.servers.labview is not registered'));
      if (entry) {
        const cmd = Array.isArray(entry.command) ? entry.command.join(' ') : entry.command;
        record(check(String(cmd || '').toLowerCase() === exe.toLowerCase(), `command points at ${exe}`, `command points elsewhere: ${cmd}`));
      }
      const perms = Array.isArray(data.permissions) ? data.permissions : [];
      const present = LABVIEW_PERMISSIONS.filter((r) => perms.some((p) => p.action === r.action && p.resource === r.resource && p.effect === r.effect)).length;
      record(check(present === LABVIEW_PERMISSIONS.length, `${present}/${LABVIEW_PERMISSIONS.length} permission rules present`, `${present}/${LABVIEW_PERMISSIONS.length} permission rules present`));
    } catch (error) {
      record(check(false, '', error.message));
    }
  }

  step('Agents');
  const agents = installedAgents(agentsDir);
  record(check(agents.length === AGENT_FILES.length, `${agents.length}/${AGENT_FILES.length} agents installed in ${agentsDir}`, `${agents.length}/${AGENT_FILES.length} agents installed in ${agentsDir}`));

  log(`\n${bold('Summary')}: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    warn('Some checks failed. Re-run `opencode-labview-mcp install` or fix the reported path.');
    process.exitCode = 1;
  }
  return { passed, failed };
}
