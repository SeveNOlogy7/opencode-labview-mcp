import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_FILES, installAgents, installedAgents, removeAgents } from '../src/agents.js';

const MARKER = '<!-- managed by opencode-labview-mcp; re-run install to update -->';
const BIN = 'C:\\Users\\test\\.local\\labview-mcp\\bin';

function tempAgentsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'olm-agents-'));
}

test('installs all eight agent definitions', () => {
  const dir = tempAgentsDir();
  const written = installAgents(dir, BIN);
  assert.equal(written.length, 8);
  assert.equal(AGENT_FILES.length, 8);
  for (const name of AGENT_FILES) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(text.startsWith('---'), `${name} keeps front matter at the top`);
    assert.ok(text.includes(MARKER), `${name} carries the managed marker`);
  }
});

test('replaces the bin path placeholder with the install path', () => {
  const dir = tempAgentsDir();
  installAgents(dir, BIN);
  for (const name of AGENT_FILES) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal(text.includes('__LABVIEW_MCP_BIN__'), false, `${name} has no placeholder left`);
    assert.ok(text.includes(BIN), `${name} references ${BIN}`);
  }
});

test('does not use an absolute path from the build machine', () => {
  const dir = tempAgentsDir();
  installAgents(dir, BIN);
  for (const name of AGENT_FILES) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.equal(text.includes('C:\\Users\\Loren'), false, `${name} leaks no build-machine path`);
  }
});

test('re-running overwrites managed files without creating backups', () => {
  const dir = tempAgentsDir();
  installAgents(dir, BIN);
  const second = installAgents(dir, BIN);
  assert.equal(second.filter((w) => w.backup).length, 0);
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.bak-')).length, 0);
});

test('a hand-written agent with the same name is backed up, not clobbered silently', () => {
  const dir = tempAgentsDir();
  const name = AGENT_FILES[0];
  const original = '---\ndescription: mine\n---\n\nhand written\n';
  fs.writeFileSync(path.join(dir, name), original, 'utf8');
  const written = installAgents(dir, BIN);
  const entry = written.find((w) => w.name === name);
  assert.ok(entry.backup);
  assert.equal(fs.readFileSync(entry.backup, 'utf8'), original);
  assert.ok(fs.readFileSync(path.join(dir, name), 'utf8').includes(MARKER));
});

test('removeAgents only deletes managed files', () => {
  const dir = tempAgentsDir();
  installAgents(dir, BIN);
  const foreign = 'labview-vi-generator-copy.md';
  fs.writeFileSync(path.join(dir, foreign), 'not managed\n', 'utf8');
  const result = removeAgents(dir);
  assert.equal(result.removed.length, 8);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(installedAgents(dir), []);
  assert.ok(fs.existsSync(path.join(dir, foreign)));
});

test('removeAgents skips an unmanaged file that reuses a managed name', () => {
  const dir = tempAgentsDir();
  const name = AGENT_FILES[1];
  fs.writeFileSync(path.join(dir, name), '---\ndescription: mine\n---\n', 'utf8');
  const result = removeAgents(dir);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.skipped, [name]);
  assert.ok(fs.existsSync(path.join(dir, name)));
});
