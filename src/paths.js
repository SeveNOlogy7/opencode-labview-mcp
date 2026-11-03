import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const isWindowsX64 = process.platform === 'win32' && process.arch === 'x64';

export function homeDir() {
  return os.homedir();
}

export function defaultInstallRoot() {
  return process.env.OPENCODE_LABVIEW_MCP_HOME || path.join(homeDir(), '.local', 'labview-mcp');
}

export function globalConfigCandidates() {
  const dir = path.join(homeDir(), '.config', 'opencode');
  return [path.join(dir, 'opencode.jsonc'), path.join(dir, 'opencode.json')];
}

export function projectConfigCandidates(cwd = process.cwd()) {
  return [path.join(cwd, 'opencode.jsonc'), path.join(cwd, 'opencode.json')];
}

export function resolveConfigPath(scope, explicit) {
  if (explicit) return path.resolve(explicit);
  const candidates = scope === 'project' ? projectConfigCandidates() : globalConfigCandidates();
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

export function resolveAgentsDir(scope, explicit) {
  if (explicit) return path.resolve(explicit);
  if (scope === 'project') return path.join(process.cwd(), '.opencode', 'agents');
  return path.join(homeDir(), '.config', 'opencode', 'agents');
}

export function resolveBinDir(installRoot) {
  return path.join(installRoot, 'bin');
}

export function resolveExe(installRoot) {
  return path.join(resolveBinDir(installRoot), 'LabVIEWMCP.exe');
}

export function installedVersion(installRoot) {
  const file = path.join(installRoot, 'VERSION.txt');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^version:\s*(.+)$/m) || text.match(/^tag:\s*v?(.+)$/m);
  return m ? m[1].trim() : null;
}
