#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from '../src/install.js';
import { update } from '../src/update.js';
import { doctor } from '../src/doctor.js';
import { uninstall } from '../src/uninstall.js';
import { bold, dim, fatal, log, warn } from '../src/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

const HELP = `${bold('opencode-labview-mcp')} ${dim(`v${pkg.version}`)}

Install and manage the Zuehlke LabVIEW MCP server for OpenCode (Windows x64).

${bold('Usage')}
  opencode-labview-mcp <command> [options]

${bold('Commands')}
  install       Download, verify and register the server, permissions and agents
  update        Replace the installed binary with a newer release
  doctor        Check the binary, config, permissions and agents
  uninstall     Remove the server, its permissions, managed agents and binary
  version       Print the installer version
  help          Print this help

${bold('Options')}
  --scope <user|project>   Which OpenCode config to edit (default: user)
  --config <file>          Explicit opencode.json(c) path
  --agents-dir <dir>       Explicit agents directory
  --install-root <dir>     Install directory (default: ~/.local/labview-mcp)
  --exe <file>             Use an existing LabVIEWMCP.exe instead of downloading
  --zip <file>             Install from a local labview-mcp.zip
  --sha256 <file>          SHA-256 file that belongs to --zip
  --release <tag>          Release tag to install (default: latest)
  --force                  Reinstall even when the version is current
  --deep                   Also run the LabVIEW MCP self-test
  --dry-run                Show what would change without writing anything
  --no-agents              Do not install the agent definitions
  --keep-config            uninstall: leave the OpenCode config untouched
  --keep-agents            uninstall: leave the agent files untouched
  --keep-binary            uninstall: leave the install directory untouched
  -y, --yes                Do not ask for confirmation
  -h, --help               Print this help
  -v, --version            Print the installer version

${bold('Environment')}
  GITHUB_TOKEN             Raises the GitHub API rate limit
  OPENCODE_LABVIEW_MCP_HOME  Overrides the default install directory

${bold('Examples')}
  npx opencode-labview-mcp install
  npx opencode-labview-mcp install --exe "C:\\Tools\\labview-mcp\\bin\\LabVIEWMCP.exe"
  npx opencode-labview-mcp doctor --deep
  npx opencode-labview-mcp update --release v2.4.3
`;

const VALUE_FLAGS = new Set([
  '--scope',
  '--config',
  '--agents-dir',
  '--install-root',
  '--exe',
  '--zip',
  '--sha256',
  '--release',
]);

const BOOLEAN_FLAGS = new Set([
  '--force',
  '--deep',
  '--dry-run',
  '--no-agents',
  '--keep-config',
  '--keep-agents',
  '--keep-binary',
  '-y',
  '--yes',
]);

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      opts.versionFlag = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        fatal(`${arg} requires a value`);
      }
      i += 1;
      const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[key] = value;
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg)) {
      if (arg === '-y' || arg === '--yes') opts.yes = true;
      else {
        const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        opts[key] = true;
      }
      continue;
    }
    if (arg.startsWith('-')) fatal(`unknown option: ${arg}`);
    positional.push(arg);
  }
  return { command: positional[0], positional, opts };
}

function normalize(opts) {
  return {
    scope: opts.scope === 'project' ? 'project' : 'user',
    config: opts.config,
    agentsDir: opts.agentsDir,
    installRoot: opts.installRoot,
    exe: opts.exe,
    zip: opts.zip,
    sha256: opts.sha256,
    version: opts.release,
    force: Boolean(opts.force),
    deep: Boolean(opts.deep),
    dryRun: Boolean(opts.dryRun),
    noAgents: Boolean(opts.noAgents),
    keepConfig: Boolean(opts.keepConfig),
    keepAgents: Boolean(opts.keepAgents),
    keepBinary: Boolean(opts.keepBinary),
    yes: Boolean(opts.yes),
  };
}

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));

  if (opts.versionFlag || command === 'version') {
    log(pkg.version);
    return;
  }
  if (opts.help || command === 'help' || !command) {
    log(HELP);
    if (!command && !opts.help) process.exitCode = 1;
    return;
  }
  if (opts.scope && opts.scope !== 'user' && opts.scope !== 'project') {
    fatal(`--scope must be "user" or "project", got "${opts.scope}"`);
  }

  const normalized = normalize(opts);
  switch (command) {
    case 'install':
      await install(normalized);
      break;
    case 'update':
      await update(normalized);
      break;
    case 'doctor':
      doctor(normalized);
      break;
    case 'uninstall':
      await uninstall(normalized);
      break;
    default:
      console.error(warn(`unknown command: ${command}`));
      log(HELP);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  fatal(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
