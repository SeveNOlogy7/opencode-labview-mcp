import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFile, ensureDir, log, warn } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const packageAgentsDir = path.join(packageRoot, 'agents');
const MARKER = '<!-- managed by opencode-labview-mcp; re-run install to update -->';

export const AGENT_FILES = [
  'labview-vi-generator.md',
  'labview-vi-editor.md',
  'labview-class-generator.md',
  'labview-dqmh-module.md',
  'labview-doc-generator.md',
  'labview-caraya-unit-test.md',
  'labview-lunit-unit-test.md',
  'labview-vitester-unit-test.md',
];

export function installAgents(agentsDir, binPath) {
  ensureDir(agentsDir);
  const written = [];
  for (const name of AGENT_FILES) {
    const src = path.join(packageAgentsDir, name);
    if (!fs.existsSync(src)) throw new Error(`Package is missing agent template ${name}`);
    let text = fs.readFileSync(src, 'utf8');
    if (!text.includes(MARKER)) {
      const end = text.indexOf('---', 3);
      const nl = text.indexOf('\n', end);
      text = text.slice(0, nl + 1) + '\n' + MARKER + '\n' + text.slice(nl + 1);
    }
    text = text.split('__LABVIEW_MCP_BIN__').join(binPath);
    const dest = path.join(agentsDir, name);
    let backup = null;
    if (fs.existsSync(dest)) {
      const current = fs.readFileSync(dest, 'utf8');
      if (!current.includes(MARKER)) {
        backup = backupFile(dest);
        warn(`  ${name}: existing file was not installed by this tool; backed up to ${path.basename(backup)}`);
      }
    }
    fs.writeFileSync(dest, text, 'utf8');
    written.push({ name, dest, backup });
  }
  return written;
}

export function removeAgents(agentsDir) {
  const removed = [];
  const skipped = [];
  for (const name of AGENT_FILES) {
    const file = path.join(agentsDir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(MARKER)) {
      skipped.push(name);
      continue;
    }
    fs.unlinkSync(file);
    removed.push(name);
  }
  return { removed, skipped };
}

export function installedAgents(agentsDir) {
  return AGENT_FILES.filter((name) => fs.existsSync(path.join(agentsDir, name)));
}

export function printAgentSummary(written) {
  log(`  ${written.length} agents installed into ${path.dirname(written[0]?.dest || '')}`);
}
