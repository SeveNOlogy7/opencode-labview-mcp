import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import { ensureDir, formatBytes, log, dim, warn } from './util.js';

const REPO = 'Zuehlke/labview-mcp';

function headers() {
  const h = { 'User-Agent': 'opencode-labview-mcp', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function getRelease(version) {
  const url = version
    ? `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(version.startsWith('v') ? version : `v${version}`)}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetch(url, { headers: headers(), redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`GitHub release lookup failed: ${res.status} ${res.statusText} (${url})`);
  }
  const release = await res.json();
  const assets = release.assets || [];
  const zip = assets.find((a) => a.name === 'labview-mcp.zip');
  const sha = assets.find((a) => a.name === 'labview-mcp.sha256');
  if (!zip || !sha) {
    throw new Error(`Release ${release.tag_name} is missing labview-mcp.zip or labview-mcp.sha256`);
  }
  return {
    tag: release.tag_name,
    version: String(release.tag_name).replace(/^v/, ''),
    zipUrl: zip.browser_download_url,
    shaUrl: sha.browser_download_url,
    zipSize: zip.size,
  };
}

async function fetchWithRetry(url, { attempts = 3, delayMs = 1500 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, { headers: headers(), redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
      return res;
    } catch (error) {
      last = error;
      if (attempt < attempts) {
        warn(`  download attempt ${attempt} failed (${error.cause?.code || error.message}); retrying`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw new Error(`Download failed after ${attempts} attempts: ${last?.cause?.code || last?.message || last}`);
}

export async function downloadTo(url, dest, label = 'download') {
  ensureDir(path.dirname(dest));
  const res = await fetchWithRetry(url);
  const total = Number(res.headers.get('content-length') || 0);
  let seen = 0;
  let lastLog = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    seen += chunk.length;
    if (total && seen - lastLog > 10 * 1024 * 1024) {
      lastLog = seen;
      log(dim(`  ${label}: ${formatBytes(seen)} / ${formatBytes(total)}`));
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  return { bytes: seen, total };
}

export async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => hash.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function expectedHash(shaFile) {
  const text = fs.readFileSync(shaFile, 'utf8').trim();
  const m = text.match(/^([a-f0-9]{64})\s+/i) || text.match(/^([a-f0-9]{64})$/i);
  if (!m) throw new Error(`Cannot parse SHA-256 file: ${shaFile}`);
  return m[1].toLowerCase();
}

/**
 * Verify an archive against a SHA-256 file (or an explicit digest) and unpack it.
 * Throws on a mismatch, a missing hash, or an archive without bin/LabVIEWMCP.exe.
 */
export async function verifyAndUnpack({ zipPath, shaPath, expectedSha, tempDir }) {
  if (!fs.existsSync(zipPath)) throw new Error(`Archive not found: ${zipPath}`);
  if (shaPath && !fs.existsSync(shaPath)) throw new Error(`SHA-256 file not found: ${shaPath}`);
  let expected = expectedSha ? String(expectedSha).trim().toLowerCase() : null;
  if (!expected && shaPath) expected = expectedHash(shaPath);
  const actual = await sha256File(zipPath);

  if (!expected) {
    warn(`  no SHA-256 supplied; archive hash is ${actual}`);
    warn('  continuing unverified because --sha256 was not given');
  } else if (expected !== actual) {
    throw new Error(`SHA-256 mismatch for ${path.basename(zipPath)}\n  expected ${expected}\n  actual   ${actual}`);
  } else {
    log(`  SHA-256 ${actual}`);
  }

  const extractDir = path.join(tempDir, 'extracted');
  fs.rmSync(extractDir, { recursive: true, force: true });
  ensureDir(extractDir);
  new AdmZip(zipPath).extractAllTo(extractDir, true);

  const nested = path.join(extractDir, 'bin', 'LabVIEWMCP.exe');
  const flat = path.join(extractDir, 'LabVIEWMCP.exe');
  let exe = null;
  if (fs.existsSync(nested)) exe = nested;
  else if (fs.existsSync(flat)) exe = flat;
  if (!exe) {
    throw new Error(`Archive has no bin/LabVIEWMCP.exe (looked in ${extractDir})`);
  }
  return { extractDir, exe, sha256: actual, verified: Boolean(expected) };
}

export async function fetchAndVerifyRelease({ version, tempDir } = {}) {
  const release = await getRelease(version);
  ensureDir(tempDir);
  const zipPath = path.join(tempDir, 'labview-mcp.zip');
  const shaPath = path.join(tempDir, 'labview-mcp.sha256');

  log(`Release ${release.tag} (${release.version})`);
  log(dim(`  ${release.zipUrl}`));

  await downloadTo(release.shaUrl, shaPath, 'sha256');
  await downloadTo(release.zipUrl, zipPath, 'labview-mcp.zip');

  const unpacked = await verifyAndUnpack({ zipPath, shaPath, tempDir });
  return { release, zipPath, ...unpacked };
}
