import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendPermissions,
  hasMcpServer,
  readConfig,
  removeMcpServer,
  removePermissions,
  upsertMcpServer,
} from '../src/config.js';

const RULES = [
  { action: 'labview_*', resource: '*', effect: 'ask' },
  { action: 'labview_lvai_status', resource: '*', effect: 'allow' },
];

function tempConfig(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olm-config-'));
  const file = path.join(dir, 'opencode.jsonc');
  fs.writeFileSync(file, text, 'utf8');
  return { dir, file };
}

const BASE = `{
  // user config
  "$schema": "https://opencode.ai/config.json",
  "theme": "dark",
}
`;

test('creates a config file when none exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'olm-config-'));
  const file = path.join(dir, 'opencode.jsonc');
  const result = upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\x.exe'] });
  assert.equal(result.changed, true);
  assert.equal(result.backup, null);
  const { data } = readConfig(file);
  assert.equal(data.mcp.servers.labview.command[0], 'C:\\x.exe');
  assert.equal(data.$schema, 'https://opencode.ai/config.json');
});

test('preserves comments and trailing commas when adding the server', () => {
  const { file } = tempConfig(BASE);
  upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\x.exe'], cwd: 'C:\\' });
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\/\/ user config/);
  assert.match(text, /"theme": "dark"/);
  const { data } = readConfig(file);
  assert.equal(data.mcp.servers.labview.cwd, 'C:\\');
  assert.ok(hasMcpServer(file, 'labview'));
});

test('upsert is idempotent and keeps one entry', () => {
  const { file } = tempConfig(BASE);
  const server = { type: 'local', command: ['C:\\x.exe'], cwd: 'C:\\', disabled: false };
  upsertMcpServer(file, 'labview', server);
  const second = upsertMcpServer(file, 'labview', server);
  assert.equal(second.changed, false);
  assert.equal(second.backup, null);
});

test('updates an existing server in place', () => {
  const { file } = tempConfig(BASE);
  upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\old.exe'] });
  upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\new.exe'] });
  const { data } = readConfig(file);
  assert.deepEqual(data.mcp.servers.labview.command, ['C:\\new.exe']);
});

test('backup file is written before the config changes', () => {
  const { file } = tempConfig(BASE);
  const result = upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\x.exe'] });
  assert.ok(result.backup);
  assert.ok(fs.existsSync(result.backup));
  assert.equal(fs.readFileSync(result.backup, 'utf8'), BASE);
});

test('permissions are appended without dropping existing rules', () => {
  const { file } = tempConfig(`{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [{ "action": "bash", "resource": "*", "effect": "allow" }]
}
`);
  const result = appendPermissions(file, RULES);
  assert.equal(result.added.length, 2);
  const { data } = readConfig(file);
  assert.equal(data.permissions.length, 3);
  assert.equal(data.permissions[0].action, 'bash');
});

test('permissions are not duplicated on re-run', () => {
  const { file } = tempConfig(BASE);
  appendPermissions(file, RULES);
  const second = appendPermissions(file, RULES);
  assert.deepEqual(second.added, []);
  const { data } = readConfig(file);
  assert.equal(data.permissions.length, 2);
});

test('permissions array is created when absent', () => {
  const { file } = tempConfig(BASE);
  appendPermissions(file, RULES);
  const { data } = readConfig(file);
  assert.deepEqual(data.permissions, RULES);
});

test('removePermissions removes only the managed rules', () => {
  const { file } = tempConfig(`{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "bash", "resource": "*", "effect": "allow" },
    { "action": "labview_*", "resource": "*", "effect": "ask" }
  ]
}
`);
  const result = removePermissions(file, RULES);
  assert.equal(result.removed.length, 1);
  const { data } = readConfig(file);
  assert.equal(data.permissions.length, 1);
  assert.equal(data.permissions[0].action, 'bash');
});

test('removeMcpServer removes the server and reports it', () => {
  const { file } = tempConfig(BASE);
  upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\x.exe'] });
  const result = removeMcpServer(file, 'labview');
  assert.equal(result.changed, true);
  assert.equal(hasMcpServer(file, 'labview'), false);
});

test('removeMcpServer is a no-op when nothing is registered', () => {
  const { file } = tempConfig(BASE);
  const result = removeMcpServer(file, 'labview');
  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), BASE);
});

test('removeMcpServer prunes the containers it emptied', () => {
  const { file } = tempConfig(BASE);
  upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\x.exe'] });
  removeMcpServer(file, 'labview');
  const { data } = readConfig(file);
  assert.equal(data.mcp, undefined);
  assert.equal(data.theme, 'dark');
});

test('removeMcpServer keeps a sibling server and its container', () => {
  const { file } = tempConfig(`{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "servers": { "other": { "type": "local", "command": ["C:\\\\o.exe"] } } }
}
`);
  upsertMcpServer(file, 'labview', { type: 'local', command: ['C:\\x.exe'] });
  removeMcpServer(file, 'labview');
  const { data } = readConfig(file);
  assert.ok(data.mcp.servers.other);
  assert.equal(data.mcp.servers.labview, undefined);
});

test('removePermissions drops the key when the array becomes empty', () => {
  const { file } = tempConfig(BASE);
  appendPermissions(file, RULES);
  removePermissions(file, RULES);
  const { data } = readConfig(file);
  assert.equal(data.permissions, undefined);
  assert.equal(data.$schema, 'https://opencode.ai/config.json');
});

test('refuses to mix the OpenCode 1 permission key with permissions', () => {
  const { file } = tempConfig(`{
  "$schema": "https://opencode.ai/config.json",
  "permission": { "bash": "allow" }
}
`);
  assert.throws(() => appendPermissions(file, RULES), /OpenCode 1 "permission" key/);
});
