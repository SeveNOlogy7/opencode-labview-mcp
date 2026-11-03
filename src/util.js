import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export const ok = (s) => paint('32', s);
export const warn = (s) => paint('33', s);
export const fail = (s) => paint('31', s);
export const dim = (s) => paint('2', s);
export const bold = (s) => paint('1', s);

export function log(...args) {
  console.log(...args);
}

export function step(s) {
  log(`\n${bold(s)}`);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const backedUp = new Map();

// One backup per file per process: install/uninstall touch the same config twice,
// and a single restore point per run is easier to reason about than a pile of them.
export function backupFile(file) {
  const key = path.resolve(file);
  if (backedUp.has(key)) return null;
  if (!fs.existsSync(file)) {
    backedUp.set(key, null);
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${file}.bak-labview-mcp-${stamp}`;
  fs.copyFileSync(file, backup);
  backedUp.set(key, backup);
  return backup;
}

export function resetBackupCache() {
  backedUp.clear();
}

export function run(command, args, opts = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...opts,
  });
}

export function runPowerShell(script, opts = {}) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], opts);
}

export function quotePs(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

export function stopLabviewMcpProcesses(installRoot) {
  const root = quotePs(path.resolve(installRoot));
  const script = [
    `$root = ${root}`,
    `$p = Get-CimInstance Win32_Process -Filter "Name='LabVIEWMCP.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) }`,
    `if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId } }`,
  ].join('; ');
  const res = runPowerShell(script);
  const pids = (res.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return pids;
}

export function listLabviewMcpProcesses() {
  const script = `Get-CimInstance Win32_Process -Filter "Name='LabVIEWMCP.exe'" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`;
  const res = runPowerShell(script);
  if (!res.stdout || !res.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function confirm(question, assumeYes = false) {
  if (assumeYes) return true;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export function failAndExit(message) {
  console.error(fail(`error: ${message}`));
  process.exit(1);
}
