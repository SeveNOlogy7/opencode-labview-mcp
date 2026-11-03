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
import { fetchAndVerifyRelease, getRelease } from './release.js';
import { upsertMcpServer } from './config.js';
import { installAgents } from './agents.js';
import { LABVIEW_PERMISSIONS, swapInstall, verifyExe } from './install.js';
import {
  bold,
  ensureDir,
  fatal,
  formatBytes,
  log,
  ok,
  stopLabviewMcpProcesses,
  step,
  warn,
} from './util.js';

export async function update(opts = {}) {
  if (!isWindowsX64) fatal('opencode-labview-mcp supports Windows x64 only.');
  const scope = opts.scope || 'user';
  const installRoot = path.resolve(opts.installRoot || defaultInstallRoot());
  const exe = resolveExe(installRoot);
  const config = resolveConfigPath(scope, opts.config);
  const agentsDir = resolveAgentsDir(scope, opts.agentsDir);
  const current = installedVersion(installRoot);

  step('1/4  Check release');
  const release = await getRelease(opts.release);
  log(`  installed: ${current || 'not installed'}`);
  log(`  available: ${release.tag}`);
  if (current === release.version && !opts.force) {
    log(ok('  already up to date'));
    return;
  }
  if (opts.dryRun) {
    log(`  would install ${release.tag} to ${installRoot}`);
    return;
  }

  step('2/4  Download and replace');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'labview-mcp-update-'));
  try {
    const { extractDir, zipPath } = await fetchAndVerifyRelease({ version: opts.release, tempDir: temp });
    log(`  downloaded ${formatBytes(fs.statSync(zipPath).size)}`);
    const pids = stopLabviewMcpProcesses(installRoot);
    if (pids.length) log(`  stopped ${pids.length} running LabVIEWMCP process(es): ${pids.join(', ')}`);
    else log('  no running LabVIEWMCP process under the install root');
    swapInstall(extractDir, installRoot);
    log(ok(`  replaced ${installRoot}`));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  step('3/4  Verify and update configuration');
  verifyExe(exe, Boolean(opts.deep));
  const binDir = resolveBinDir(installRoot);
  const mcp = upsertMcpServer(config, 'labview', {
    type: 'local',
    command: [exe],
    cwd: binDir,
    disabled: false,
  });
  log(mcp.changed ? ok(`  updated mcp.servers.labview in ${config}`) : '  mcp.servers.labview already current');
  if (mcp.backup) log(`  backup: ${mcp.backup}`);

  step('4/4  Agents');
  if (opts.noAgents) {
    log('  skipped (--no-agents)');
  } else {
    const written = installAgents(agentsDir, binDir);
    log(ok(`  refreshed ${written.length} agents in ${agentsDir}`));
  }

  log(`\n${bold('Updated.')} Restart OpenCode to pick up the new server.`);
  warn('The running MCP server was stopped; the current OpenCode session will not restart it.');
}
