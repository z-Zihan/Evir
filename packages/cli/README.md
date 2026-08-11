# Evir CLI

Local-first BYOM Ask and workspace Agent for the terminal. It works standalone and does not require an Evir account, backend, or Desktop process.

## Configure

```bash
evir configure \
  --protocol openai-compatible-chat \
  --base-url https://api.example.com/v1 \
  --model example-model \
  --tool-calling
```

In an interactive terminal, `configure` asks for the API key with hidden input. For automation, pass it through `EVIR_API_KEY`; the configure command imports it into the OS credential store. The key is never written to `providers.json`.

Evir Desktop and Evir CLI use the same versioned, non-secret Provider profile and the same OS credential account (`evir` / `provider:<id>:api-key`). Configure either surface and the other can use it on its next read. The CLI remains fully usable when Desktop is not installed.

Configuration location:

- macOS: `~/Library/Application Support/evir/providers.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/evir/providers.json`
- Windows: `%APPDATA%\evir\providers.json`
- Test/portable override: `$EVIR_CONFIG_DIR/evir/providers.json`

The pre-0.1 `config.json` format remains readable and is migrated on the next configure. A malformed or unsupported shared profile is rejected instead of silently overwritten.

## Use

```bash
evir doctor
evir ask "Explain this API"
evir agent "Fix the failing test" --workspace /absolute/project/path
printf 'Summarize this' | evir ask
```

`EVIR_API_KEY` has highest priority for the current process. `ask` has no workspace tools. `agent` requires `--tool-calling`, confines file and process tools to the resolved workspace, and requires interactive approval for every write or command. Non-interactive writes and commands are refused.

## Output and exit behavior

- `ask` and `agent` write model text to stdout.
- Configuration status, workspace/provider disclosure, approvals, and errors use stderr.
- Ctrl+C aborts the active request and returns `130` for Ask/Agent.
- Most other errors currently return `1`; `doctor` returns `2` when the API key is missing.

Stable categorized exit codes, JSON/JSONL run events, localized human output, and structured Agent step/verification summaries are planned but not implemented. Missing `configure` flags currently produce validation details, so automation should always pass `--protocol`, `--base-url`, and `--model` explicitly.

## Develop and package

```bash
pnpm --dir packages/cli check
pnpm --dir packages/cli test:smoke
pnpm --dir packages/cli pack:check
```

Use a temporary `EVIR_CONFIG_DIR` for development and tests so local commands do not overwrite the real Desktop/CLI Provider profile. A successful tarball build does not prove macOS, Windows, Linux Keyring or npm installation readiness.

## Product and architecture

- [CLI product and technical specification](../../docs/20-cli-product-and-technical-specification.md)
- [Product requirements](../../docs/01-product-requirements.md)
- [Technical architecture](../../docs/02-technical-architecture.md)
- [VS Code and CLI product/UI review](../../docs/reviews/vscode-cli-product-ui-review.md)
