import fs from 'node:fs';
import path from 'node:path';
import { parse, modify, applyEdits } from 'jsonc-parser';
import { backupFile, ensureDir } from './util.js';

const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };

function isEmptyObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

function read(file) {
  if (!fs.existsSync(file)) {
    return { text: '{\n  "$schema": "https://opencode.ai/config.json"\n}\n', data: { $schema: 'https://opencode.ai/config.json' } };
  }
  const text = fs.readFileSync(file, 'utf8');
  const errors = [];
  const data = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) {
    throw new Error(`Cannot parse ${file}: JSONC error at offset ${errors[0].offset}`);
  }
  return { text, data: data ?? {} };
}

function write(file, text) {
  ensureDir(path.dirname(file));
  const backup = backupFile(file);
  fs.writeFileSync(file, text, 'utf8');
  return backup;
}

function sameRule(a, b) {
  return a && b && a.action === b.action && a.resource === b.resource && a.effect === b.effect;
}

export function hasMcpServer(file, name) {
  const { data } = read(file);
  return Boolean(data.mcp?.servers?.[name] || data.mcp?.[name]);
}

export function upsertMcpServer(file, name, server) {
  const { text, data } = read(file);
  const pathToServer = data.mcp?.servers || !data.mcp?.[name] ? ['mcp', 'servers', name] : ['mcp', name];
  const edits = modify(text, pathToServer, server, { formattingOptions: FORMAT });
  const next = applyEdits(text, edits);
  if (next === text) return { changed: false, path: pathToServer, backup: null };
  return { changed: true, path: pathToServer, backup: write(file, next) };
}

export function removeMcpServer(file, name) {
  const { text, data } = read(file);
  if (!hasMcpServer(file, name)) return { changed: false, backup: null };
  const nested = Boolean(data.mcp?.servers?.[name]);
  const pathToServer = nested ? ['mcp', 'servers', name] : ['mcp', name];
  let next = applyEdits(text, modify(text, pathToServer, undefined, { formattingOptions: FORMAT }));

  // Drop containers that the removal left empty, so uninstall leaves no residue.
  const after = parse(next, [], { allowTrailingComma: true, disallowComments: false }) ?? {};
  if (nested && isEmptyObject(after.mcp?.servers)) {
    const { servers, ...rest } = after.mcp ?? {};
    const parent = isEmptyObject(rest) ? ['mcp'] : ['mcp', 'servers'];
    next = applyEdits(next, modify(next, parent, undefined, { formattingOptions: FORMAT }));
  }
  return { changed: next !== text, backup: next !== text ? write(file, next) : null };
}

export function appendPermissions(file, rules) {
  const { text, data } = read(file);
  if (data.permission && !data.permissions) {
    throw new Error(`${file} uses the OpenCode 1 "permission" key; this installer targets OpenCode 2 "permissions".`);
  }
  const existing = Array.isArray(data.permissions) ? data.permissions : [];
  const missing = rules.filter((r) => !existing.some((e) => sameRule(e, r)));
  if (!missing.length) return { added: [], backup: null };

  let next = text;
  if (!Array.isArray(data.permissions)) {
    const edits = modify(next, ['permissions'], rules, { formattingOptions: FORMAT });
    next = applyEdits(next, edits);
  } else {
    let length = existing.length;
    for (const rule of missing) {
      const edits = modify(next, ['permissions', length], rule, { formattingOptions: FORMAT });
      next = applyEdits(next, edits);
      length += 1;
    }
  }
  return { added: missing, backup: next !== text ? write(file, next) : null };
}

export function removePermissions(file, rules) {
  const { text, data } = read(file);
  if (!Array.isArray(data.permissions)) return { removed: [], backup: null };
  const remaining = data.permissions.filter((e) => !rules.some((r) => sameRule(e, r)));
  const removed = data.permissions.filter((e) => rules.some((r) => sameRule(e, r)));
  if (!removed.length) return { removed: [], backup: null };
  const edits = modify(text, ['permissions'], remaining, { formattingOptions: FORMAT });
  let next = applyEdits(text, edits);
  if (remaining.length === 0) {
    next = applyEdits(next, modify(next, ['permissions'], undefined, { formattingOptions: FORMAT }));
  }
  return { removed, backup: next !== text ? write(file, next) : null };
}

export function readConfig(file) {
  return read(file);
}
