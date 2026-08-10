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

## Develop and package

```bash
pnpm --dir packages/cli check
pnpm --dir packages/cli test:smoke
pnpm --dir packages/cli pack:check
```
