# Botward

A minimal single-task AI agent CLI. Read [README_ZH.md](./README_ZH.md) for the
Chinese overview and config file format reference.

## Quick start

```bash
# Install
npm install

# Run a task with a config file
npm run dev -- execute "summarize the README" -c tests/fixtures/basic.json

# Or build and use the bundled CLI
npm run build
./dist/cli.js execute "..." -c botward.json
```

## Commands

| Command | Status | Description |
|---|---|---|
| `botward execute <task> [-c config]` | ✅ | Run a single task and exit |
| `botward init <req> [-o output]` | ✅ | AI-generate a multi-file botward project (main config + tools/*.cjs + skills/*) |
| `botward chat [-c config]` | 🚧 Planned | Interactive REPL |
| `botward serve [-c config] [-p port] [--workers n]` | 🚧 Planned | HTTP service for tasks |

## Environment

- `ANTHROPIC_API_KEY` — required when config's `provider` is `anthropic`
- `OPENAI_API_KEY` — required when config's `provider` is `openai`
- `ANTHROPIC_BASE_URL` — optional, override Anthropic API endpoint
- `OPENAI_BASE_URL` — optional, override OpenAI API endpoint
- `BOTWARD_MODEL_ANTHROPIC` / `BOTWARD_MODEL_OPENAI` — optional, default model override for `init`

For `botward init` you need at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` set; the command auto-detects which provider to use.

## `botward init`

`init` reuses the same engine as `execute`: it synthesizes a config in memory that grants the model a sandboxed set of built-in tools (`read_file`, `write_file`, `list_files`, `search_files`) restricted to the directory containing the output file. The model then writes the main config plus any tool sources, skills, and permission files it needs.

```bash
# Default: writes ./botward.json (and ./tools/, ./skills/, ./permissions/ alongside)
botward init "an agent that reads files and echoes back the first line"

# Custom output path: the file's directory becomes the project root
botward init -o ./agents/notify/botward.json "a Slack notifier agent"
```

After init, run the generated config:

```bash
botward execute -c ./agents/notify/botward.json "send today's summary to #bot-updates"
```

## Development

```bash
npm run dev         # run with tsx
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # bundle to dist/cli.js
```