# opencode-labview-mcp

Installer and manager for the [Zuehlke LabVIEW MCP server](https://github.com/Zuehlke/labview-mcp)
on OpenCode, for Windows x64.

It downloads an official release, verifies its SHA-256, registers the MCP server
in OpenCode, adds a read-only-by-default permission set, and installs the eight
LabVIEW subagents (`labview-vi-generator`, `labview-vi-editor`,
`labview-class-generator`, `labview-dqmh-module`, `labview-doc-generator`,
`labview-caraya-unit-test`, `labview-lunit-unit-test`,
`labview-vitester-unit-test`).

## Requirements

- Windows x64
- Node.js 20 or newer
- OpenCode 2.x
- LabVIEW 2020+ installed and **running** (32-bit or 64-bit, matching the server)
- Network access to `api.github.com` and `github.com` for the download

## Quick start

```powershell
npx opencode-labview-mcp install
```

Then restart OpenCode and ask it to call `labview_lvai_status`. A healthy answer
looks like:

```json
{ "ok": true, "port": 59796, "serverVersion": "2.4.3 (4aac99a5)" }
```

If you already have `LabVIEWMCP.exe` unpacked somewhere, skip the download:

```powershell
npx opencode-labview-mcp install --exe "C:\Tools\labview-mcp\bin\LabVIEWMCP.exe"
```

## Commands

| Command | What it does |
| --- | --- |
| `install` | Download, verify, unpack, register MCP server, permissions and agents |
| `update` | Download a newer release, stop the running server, replace the install |
| `doctor` | Check platform, binary, LabVIEW installs, config, permissions, agents |
| `uninstall` | Remove the MCP entry, permission rules, managed agents and binary |
| `version` | Print the installer version |

Common options:

```text
--scope <user|project>     Which OpenCode config to edit (default: user)
--config <file>            Explicit opencode.json(c) path
--agents-dir <dir>         Explicit agents directory
--install-root <dir>       Install directory (default: ~/.local/labview-mcp)
--exe <file>               Use an existing LabVIEWMCP.exe
--zip <file>               Install from a local labview-mcp.zip
--sha256 <file>            SHA-256 file for --zip
--release <tag>            Release tag to install (default: latest)
--force                    Reinstall even when the version is current
--deep                     Also run the LabVIEW MCP self-test
--dry-run                  Show what would change, write nothing
--no-agents                Skip the agent definitions
-y, --yes                  Do not ask for confirmation
```

`uninstall` also accepts `--keep-config`, `--keep-agents` and `--keep-binary`.

### Offline or behind a firewall

`github.com` release downloads are sometimes unreachable while `api.github.com`
still answers. Download `labview-mcp.zip` and `labview-mcp.sha256` from the
release page in a browser, then install from disk:

```powershell
npx opencode-labview-mcp install --zip .\labview-mcp.zip --sha256 .\labview-mcp.sha256
```

Without `--sha256` the archive is still unpacked, but the installer prints the
computed hash and a warning instead of verifying it. Use `install --force --zip`
to replace an existing install from a local archive.

## What gets written

Default user scope:

| Path | Content |
| --- | --- |
| `~/.local/labview-mcp/` | Unpacked upstream release (`bin/LabVIEWMCP.exe`, `bin/pylabview`, `scripts`, `docs`) |
| `~/.config/opencode/opencode.jsonc` | `mcp.servers.labview` plus the permission rules |
| `~/.config/opencode/agents/labview-*.md` | Eight subagent definitions |

Every file the installer touches is backed up first as
`<name>.bak-labview-mcp-<timestamp>`. Agent files carry a
`managed by opencode-labview-mcp` marker; `update` overwrites them, `uninstall`
only deletes files that carry the marker, and a pre-existing hand-written agent
is backed up rather than silently replaced.

With `--scope project` the config is `./opencode.jsonc` and the agents go to
`./.opencode/agents/`.

### MCP entry

```jsonc
{
  "mcp": {
    "servers": {
      "labview": {
        "type": "local",
        "command": ["C:\\Users\\you\\.local\\labview-mcp\\bin\\LabVIEWMCP.exe"],
        "cwd": "C:\\Users\\you\\.local\\labview-mcp\\bin",
        "disabled": false
      }
    }
  }
}
```

### Permissions

OpenCode exposes the tools as `labview_<tool>`. The installer adds:

```jsonc
{
  "permissions": [
    { "action": "labview_*", "resource": "*", "effect": "ask" },
    { "action": "labview_lvai_status", "resource": "*", "effect": "allow" },
    // ... 19 read-only tools in total, including describe/validate/reference/status
  ]
}
```

Everything that writes files or drives LabVIEW (`lvai_generate_*`,
`lvai_apply_*`, `lvai_run_*`, `pylv_apply`, …) keeps the `ask` default.

## Verify

```powershell
npx opencode-labview-mcp doctor --deep
```

`doctor` exits non-zero when a check fails, so it works as a CI or post-update
gate. `--deep` runs the upstream `--selftest` (8 checks) and needs a minute or
two.

## Updating

```powershell
npx opencode-labview-mcp update
```

`update` stops only `LabVIEWMCP.exe` processes whose executable lives under the
install root, swaps the directory, re-verifies, and rewrites the config. The
already-running OpenCode session keeps the old process handle, so restart
OpenCode afterwards.

## Why not an OpenCode plugin?

OpenCode 2.x plugins are loaded as `export default { id, setup(ctx) }`, and the
`ctx` surface has `agent`, `aisdk`, `catalog`, `command`, `integration`,
`plugin`, `reference` and `skill` domains — no `mcp`, `tool` or `config` domain.
A plugin therefore cannot register an MCP server or expose tools, and the 1.x
`{ id, server }` shape is rejected by the 2.x loader with:

```text
Plugin must export a default definition with an id and an effect or setup function
```

An installer CLI is the supported route. The only plugin-shaped piece that does
work is `ctx.agent.transform`, which is why the agents could in principle be
shipped as a plugin; the MCP server still has to come from configuration.

## Security notes

- The binary is not bundled. It is fetched from the upstream GitHub release and
  checked against that release's own `labview-mcp.sha256` before unpacking.
- Set `GITHUB_TOKEN` to avoid anonymous API rate limits.
- The upstream project is research-grade. A LabVIEW upgrade can break it; run
  `doctor --deep` after upgrading LabVIEW or the server.
- The mutating tools overwrite VI files. Work on copies and keep the project
  under version control.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `GitHub release lookup failed: 403` | Set `GITHUB_TOKEN`, or retry later |
| `SHA-256 mismatch` | Download was truncated or intercepted; retry. Do not bypass the check |
| `mcp.servers.labview` missing after install | Check `--scope`; project scope writes `./opencode.jsonc` |
| Tools appear but every call fails | Start LabVIEW, then run `doctor --deep` |
| Installer refuses to run | Windows x64 only; the package declares `os`/`cpu` |
| `permission` key error | The config uses the OpenCode 1 format; migrate it to `permissions` |

## Development

```powershell
git clone https://github.com/SeveNOlogy7/opencode-labview-mcp.git
cd opencode-labview-mcp
npm ci
npm test
```

The tests cover the JSONC editing (comments and trailing commas survive), the
agent templates, SHA-256 verification, archive unpacking and HTTP download.
They do not need LabVIEW, OpenCode or network access.

## Releasing

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC) and [staged publishing](https://docs.npmjs.com/staged-publishing), so
there is no long-lived `NPM_TOKEN` and no version goes live without a human.

1. **Trusted publisher.** On npmjs.com open the package → *Settings* →
   *Trusted Publisher* → *GitHub Actions* and enter:

   | Field | Value |
   | --- | --- |
   | Organization or user | `SeveNOlogy7` |
   | Repository | `opencode-labview-mcp` |
   | Workflow filename | `publish.yml` |
   | Allowed actions | leave `npm publish` **unchecked** (staged only) |

   Leaving `npm publish` unchecked means the workflow can only stage a version;
   a maintainer must approve it with 2FA. The first successful staged publish
   must happen within two days of creating the configuration, otherwise it
   expires and has to be recreated.

2. **Release.** Bump `version` in `package.json`, commit, then
   `git tag v0.1.1` and `git push origin main --tags`. The workflow runs
   `npm ci`, `npm test`, checks that the tag equals `v<version>`, and stages
   the package with provenance.

3. **Approve.** A maintainer reviews and approves the staged version:

   ```powershell
   npm stage list
   npm stage approve <stage-id>
   ```

   or uses the *Staged Packages* tab on npmjs.com. Approval requires 2FA and
   is the point where the version becomes public.

## License

MIT for this installer. The upstream binary and the agent definitions keep their
own license; see [NOTICE](./NOTICE). Not affiliated with National Instruments,
Emerson, or Zuehlke Engineering.
