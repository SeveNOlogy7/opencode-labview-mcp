import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'bin', 'cli.js');

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
}

test('version prints the package version', () => {
  const result = run(['version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('help exits zero and lists every command', () => {
  const result = run(['help']);
  assert.equal(result.status, 0);
  for (const command of ['install', 'update', 'doctor', 'uninstall']) {
    assert.ok(result.stdout.includes(command), `help mentions ${command}`);
  }
});

test('no command prints help and exits non-zero', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Usage/);
});

test('an unknown option is reported on stderr and exits non-zero', () => {
  const result = run(['install', '--nope']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /error: unknown option: --nope/);
});

test('a missing flag value is reported on stderr', () => {
  const result = run(['install', '--exe']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /error: --exe requires a value/);
});

test('an invalid scope is rejected', () => {
  const result = run(['install', '--scope', 'global']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--scope must be "user" or "project"/);
});

test('a missing --exe path fails loudly instead of continuing', () => {
  const result = run(['install', '--exe', 'C:\\definitely\\missing\\LabVIEWMCP.exe', '--dry-run']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /error: --exe not found/);
});

test('a missing --zip path fails loudly', () => {
  const result = run(['install', '--zip', 'C:\\definitely\\missing\\labview-mcp.zip']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /error: --zip not found/);
});

test('an unknown command prints help and exits non-zero', () => {
  const result = run(['frobnicate']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command: frobnicate/);
});
