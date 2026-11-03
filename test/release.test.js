import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { downloadTo, expectedHash, sha256File, verifyAndUnpack } from '../src/release.js';

function tempDir(prefix = 'olm-release-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeZip(entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

function writeZip(dir, entries) {
  const file = path.join(dir, 'labview-mcp.zip');
  fs.writeFileSync(file, makeZip(entries));
  return file;
}

test('verifies a matching archive and finds bin/LabVIEWMCP.exe', async () => {
  const dir = tempDir();
  const zipPath = writeZip(dir, { 'bin/LabVIEWMCP.exe': 'stub', 'VERSION.txt': 'version: 2.4.3\n' });
  const shaPath = path.join(dir, 'labview-mcp.sha256');
  fs.writeFileSync(shaPath, `${await sha256File(zipPath)}  labview-mcp.zip\n`);

  const result = await verifyAndUnpack({ zipPath, shaPath, tempDir: path.join(dir, 'work') });
  assert.equal(result.verified, true);
  assert.equal(result.exe, path.join(dir, 'work', 'extracted', 'bin', 'LabVIEWMCP.exe'));
  assert.ok(fs.existsSync(result.exe));
  assert.equal(fs.readFileSync(result.exe, 'utf8'), 'stub');
});

test('rejects a mismatching SHA-256', async () => {
  const dir = tempDir();
  const zipPath = writeZip(dir, { 'bin/LabVIEWMCP.exe': 'stub' });
  const shaPath = path.join(dir, 'labview-mcp.sha256');
  fs.writeFileSync(shaPath, `${'0'.repeat(64)}  labview-mcp.zip\n`);

  await assert.rejects(
    () => verifyAndUnpack({ zipPath, shaPath, tempDir: path.join(dir, 'work') }),
    /SHA-256 mismatch/,
  );
});

test('accepts an explicit digest instead of a sha file', async () => {
  const dir = tempDir();
  const zipPath = writeZip(dir, { 'bin/LabVIEWMCP.exe': 'stub' });
  const digest = await sha256File(zipPath);
  const result = await verifyAndUnpack({ zipPath, expectedSha: digest.toUpperCase(), tempDir: path.join(dir, 'work') });
  assert.equal(result.sha256, digest);
});

test('unverified archives are accepted but flagged', async () => {
  const dir = tempDir();
  const zipPath = writeZip(dir, { 'bin/LabVIEWMCP.exe': 'stub' });
  const result = await verifyAndUnpack({ zipPath, tempDir: path.join(dir, 'work') });
  assert.equal(result.verified, false);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('rejects an archive without the server binary', async () => {
  const dir = tempDir();
  const zipPath = writeZip(dir, { 'README.md': 'nothing here' });
  const digest = await sha256File(zipPath);
  await assert.rejects(
    () => verifyAndUnpack({ zipPath, expectedSha: digest, tempDir: path.join(dir, 'work') }),
    /no bin\/LabVIEWMCP\.exe/,
  );
});

test('accepts a flat archive that has the binary at the root', async () => {
  const dir = tempDir();
  const zipPath = writeZip(dir, { 'LabVIEWMCP.exe': 'stub' });
  const digest = await sha256File(zipPath);
  const result = await verifyAndUnpack({ zipPath, expectedSha: digest, tempDir: path.join(dir, 'work') });
  assert.equal(result.exe, path.join(dir, 'work', 'extracted', 'LabVIEWMCP.exe'));
});

test('expectedHash parses the upstream sha file format', () => {
  const dir = tempDir();
  const file = path.join(dir, 'labview-mcp.sha256');
  const digest = crypto.createHash('sha256').update('x').digest('hex');
  fs.writeFileSync(file, `${digest}  labview-mcp.zip\n`);
  assert.equal(expectedHash(file), digest);
});

test('expectedHash rejects garbage', () => {
  const dir = tempDir();
  const file = path.join(dir, 'bad.sha256');
  fs.writeFileSync(file, 'not a hash\n');
  assert.throws(() => expectedHash(file), /Cannot parse SHA-256 file/);
});

test('downloadTo writes the response body to disk', async () => {
  const payload = crypto.randomBytes(4096);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-length': payload.length });
    res.end(payload);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const dir = tempDir();
  const dest = path.join(dir, 'nested', 'file.bin');
  try {
    const result = await downloadTo(`http://127.0.0.1:${port}/file.bin`, dest, 'test');
    assert.equal(result.bytes, payload.length);
    assert.deepEqual(fs.readFileSync(dest), payload);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
