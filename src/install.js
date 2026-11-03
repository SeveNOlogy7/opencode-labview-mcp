import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultInstallRoot,
  installedVersion,
  isWindowsX64,
  resolveAgentsDir,
  resolveBinDir,
  resolveConfigPath,
  resolveExe,
} from './paths.js';
import { fetchAndVerifyRelease, verifyAndUnpack } from './release.js';
import { appendPermissions, upsertMcpServer } from './config.js';
import { installAgents } from './agents.js';
import {
  bold,
  confirm,
  ensureDir,
  fatal,
  formatBytes,
  log,
  ok,
  run,
  step,
  stopLabviewMcpProcesses,
  warn,
} from './util.js';

export const LABVIEW_PERMISSIONS = [
  { action: 'labview_*', resource: '*', effect: 'ask' },
  { action: 'labview_lvai_status', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_dump_schema', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_get_application_configuration', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_describe_vi', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_describe_project', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_search_info_cache', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_lookup_info_cache_items', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_filter_palette_search_candidates', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_filter_example_search_candidates', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_convert_vi_to_aixml', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_validate_aixml', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_aixml_reference', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_dqmh_reference', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_lvproj_reference', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_list_labview_installations', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_lvlib_reference', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_vi_server_reference', resource: '*', effect: 'allow' },
  { action: 'labview_lvai_palette_index', resource: '*', effect: 'allow' },
  { action: 'labview_pylv_status', resource: '*', effect: 'allow' },
];

export function swapInstall(extractDir, installRoot) {
  ensureDir(path.dirname(installRoot));
  const old = `${installRoot}.old-${Date.now()}`;
  let moved = false;
  if (fs.existsSync(installRoot)) {
    fs.renameSync(installRoot, old);
    moved = true;
  }
  try {
    fs.renameSync(extractDir, installRoot);
  } catch (error) {
    if (moved) fs.renameSync(old, installRoot);
    throw error;
  }
  if (moved) fs.rmSync(old, { recursive: true, force: true });
}

export function verifyExe(exe, deep) {
  const res = run(exe, ['--pylv-status'], { timeout: 120000 });
  if (res.status !== 0) {
    warn(`  ${path.basename(exe)} --pylv-status exited ${res.status}`);
    if (res.stderr) warn(res.stderr.trim());
  } else {
    const first = (res.stdout || '').split(/\r?\n/).filter(Boolean).slice(0, 3);
    for (const line of first) log(`  ${line}`);
  }
  if (deep) {
    log('  running self-test...');
    const test = run(exe, ['--selftest'], { timeout: 180000 });
    log(test.stdout || '');
    if (test.status !== 0) throw new Error('LabVIEW MCP self-test failed');
  }
}

export async function install(opts = {}) {
  if (!isWindowsX64) fatal('opencode-labview-mcp supports Windows x64 only.');
  const scope = opts.scope || 'user';
  const installRoot = path.resolve(opts.installRoot || defaultInstallRoot());
  const exe = opts.exe ? path.resolve(opts.exe) : resolveExe(installRoot);
  const config = resolveConfigPath(scope, opts.config);
  const agentsDir = resolveAgentsDir(scope, opts.agentsDir);

  step('1/4  LabVIEW MCP server');
  let binDir;

  if (opts.exe) {
    if (!fs.existsSync(exe)) fatal(`--exe not found: ${exe}`);
    binDir = path.dirname(exe);
    log(`  using existing binary: ${exe}`);
    log(`  version: ${installedVersion(path.dirname(binDir)) || installedVersion(installRoot) || 'unknown'}`);
  } else if (!opts.zip && fs.existsSync(exe) && !opts.force) {
    binDir = path.dirname(exe);
    log(`  already installed: ${exe}`);
    log(`  version: ${installedVersion(installRoot) || 'unknown'}`);
    log('  use --force (with --zip) to replace it');
  } else if (opts.zip) {
    const zip = path.resolve(opts.zip);
    if (!fs.existsSync(zip)) fatal(`--zip not found: ${zip}`);
    if (opts.dryRun) {
      log(`  would install ${zip} into ${installRoot}`);
      return;
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'labview-mcp-zip-'));
    try {
      const unpacked = await verifyAndUnpack({
        zipPath: zip,
        shaPath: opts.sha256 ? path.resolve(opts.sha256) : undefined,
        tempDir: temp,
      });
      if (fs.existsSync(installRoot)) {
        const pids = stopLabviewMcpProcesses(installRoot);
        if (pids.length) log(`  stopped ${pids.length} running LabVIEWMCP process(es): ${pids.join(', ')}`);
      }
      swapInstall(unpacked.extractDir, installRoot);
      binDir = resolveBinDir(installRoot);
      log(ok(`  installed from ${path.basename(zip)} to ${installRoot}`));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  } else {
    if (opts.dryRun) {
      log(`  would download the latest release and install to ${installRoot}`);
      return;
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'labview-mcp-install-'));
    try {
      const { release, extractDir, zipPath } = await fetchAndVerifyRelease({ version: opts.release, tempDir: temp });
      const size = fs.statSync(zipPath).size;
      log(`  downloaded ${formatBytes(size)}`);
      if (fs.existsSync(installRoot)) {
        const pids = stopLabviewMcpProcesses(installRoot);
        if (pids.length) log(`  stopped ${pids.length} running LabVIEWMCP process(es): ${pids.join(', ')}`);
      }
      swapInstall(extractDir, installRoot);
      binDir = resolveBinDir(installRoot);
      log(ok(`  installed ${release.tag} to ${installRoot}`));
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }

  step('2/4  Verify binary');
  if (opts.dryRun) log(`  would run ${path.basename(exe)} --pylv-status`);
  else verifyExe(exe, Boolean(opts.deep));

  step('3/4  OpenCode configuration');
  if (opts.dryRun) {
    log(`  would register mcp.servers.labview in ${config}`);
    log(`  would add ${LABVIEW_PERMISSIONS.length} permission rules`);
  } else {
    const server = {
      type: 'local',
      command: [exe],
      cwd: binDir,
      disabled: false,
    };
    const mcp = upsertMcpServer(config, 'labview', server);
    if (mcp.changed) log(ok(`  registered mcp.servers.labview in ${config}`));
    else log('  mcp.servers.labview already present; left unchanged');
    if (mcp.backup) log(`  backup: ${mcp.backup}`);

    const perms = appendPermissions(config, LABVIEW_PERMISSIONS);
    if (perms.added.length) log(ok(`  added ${perms.added.length} permission rules`));
    else log('  permission rules already present');
    if (perms.backup) log(`  backup: ${perms.backup}`);
  }

  step('4/4  Agents');
  if (opts.noAgents) {
    log('  skipped (--no-agents)');
  } else if (opts.dryRun) {
    log(`  would install 8 agents into ${agentsDir}`);
  } else {
    const written = installAgents(agentsDir, binDir);
    log(ok(`  installed ${written.length} agents into ${agentsDir}`));
  }

  log(`\n${bold('Done.')} Restart OpenCode, then ask it to call ${bold('labview_lvai_status')}.`);
  if (!opts.dryRun) {
    log(`  config : ${config}`);
    log(`  binary : ${exe}`);
    log(`  agents : ${agentsDir}`);
    log(`\nLabVIEW must be running for the lvai_* tools. Work on copies: the mutating tools overwrite VIs.`);
  }
}
