import fs from 'node:fs';
import path from 'node:path';
import { defaultInstallRoot, isWindowsX64, resolveAgentsDir, resolveConfigPath } from './paths.js';
import { removeMcpServer, removePermissions } from './config.js';
import { removeAgents } from './agents.js';
import { LABVIEW_PERMISSIONS } from './install.js';
import {
  bold,
  confirm,
  fail,
  log,
  ok,
  stopLabviewMcpProcesses,
  step,
  warn,
} from './util.js';

export async function uninstall(opts = {}) {
  if (!isWindowsX64) fail('opencode-labview-mcp supports Windows x64 only.');
  const scope = opts.scope || 'user';
  const installRoot = path.resolve(opts.installRoot || defaultInstallRoot());
  const config = resolveConfigPath(scope, opts.config);
  const agentsDir = resolveAgentsDir(scope, opts.agentsDir);

  if (!opts.yes) {
    const yes = await confirm(
      `Remove the labview MCP entry, its permission rules, the managed agents, and ${installRoot}?`,
      false,
    );
    if (!yes) {
      log('Cancelled.');
      return;
    }
  }

  step('1/3  OpenCode config');
  if (!opts.keepConfig && fs.existsSync(config)) {
    const mcp = removeMcpServer(config, 'labview');
    log(mcp.changed ? ok(`  removed mcp.servers.labview from ${config}`) : '  mcp.servers.labview was not registered');
    if (mcp.backup) log(`  backup: ${mcp.backup}`);
    const perms = removePermissions(config, LABVIEW_PERMISSIONS);
    log(perms.removed.length ? ok(`  removed ${perms.removed.length} permission rules`) : '  no matching permission rules');
    if (perms.backup) log(`  backup: ${perms.backup}`);
  } else {
    log('  skipped');
  }

  step('2/3  Agents');
  if (!opts.keepAgents) {
    const result = removeAgents(agentsDir);
    log(result.removed.length ? ok(`  removed ${result.removed.length} managed agents`) : '  no managed agents found');
    if (result.skipped.length) warn(`  kept ${result.skipped.length} agent file(s) not managed by this tool: ${result.skipped.join(', ')}`);
  } else {
    log('  skipped');
  }

  step('3/3  Binary');
  if (!opts.keepBinary && fs.existsSync(installRoot)) {
    const pids = stopLabviewMcpProcesses(installRoot);
    if (pids.length) log(`  stopped ${pids.length} running LabVIEWMCP process(es)`);
    fs.rmSync(installRoot, { recursive: true, force: true });
    log(ok(`  removed ${installRoot}`));
  } else {
    log('  kept');
  }

  log(`\n${bold('Uninstalled.')} Restart OpenCode to drop the tools.`);
}
