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

## Programmatic API

`botward` is also a library. The CLI is a thin wrapper over the same
engine; you can drive it from Node:

```js
import Botward from 'botward';

const botward = new Botward({
  providers: [{
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
  }],
});

const result = await botward.execute(
  'summarize the README',
  { config: 'botward.json' },
);
console.log(result.finalText);  // string, no stdout side effect
```

### `new Botward(options)`

| Field | Type | Notes |
|---|---|---|
| `providers` | `ProviderConfig[]` | Required, at least one. Each `type` may appear once; use `model` to differentiate. |
| `cwd` | `string?` | Default `process.cwd()`. Resolves relative `config` / `output` paths. |
| `llmFactory` | `(config, opts) => LLMClient?` | Test seam. Default uses the bundled factory. |

`ProviderConfig`:

```ts
{ type: 'anthropic' | 'openai', apiKey?: string, baseUrl?: string, model?: string }
```

### `botward.execute(task, { config }) -> Promise<AgentRunResult>`

Loads `config` (a path to a `botward.json`), drives the same agent loop
as `botward execute`. Returns `{ finalText, iterations, stopReason }`.
Does not write to stdout. Throws `BotwardError` on bad config or loop
failure.

### `botward.init(requirements, { output, provider?, model? }) -> Promise<InitResult>`

Same engine as `botward init`. Auto-creates `output`'s directory.
Returns `{ result, outputPath, outputDir, provider, model }`. Throws
`BotwardError` if the model never writes the main config.

```js
const { outputPath, result } = await botward.init(
  'an agent that reads files and echoes the first line',
  { output: 'agents/notify/botward.json' },
);
```

### Provider resolution

`providers` is an ordered array. Resolution rules:

1. Constructor rejects empty arrays, unknown `type`, and duplicate `type`.
2. `execute` looks up the entry whose `type === config.provider`. Its
   `apiKey` / `baseUrl` / `model` are passed to the LLM factory, which
   still falls back to environment variables and SDK defaults when fields
   are absent.
3. `init` without an explicit `provider` picks the first entry whose
   `apiKey` is set. With an explicit `provider`, that entry must exist
   (else `BotwardError`).

### Errors

All library-thrown errors are `BotwardError` so callers can filter:

```js
import Botward, { BotwardError } from 'botward';
try { await botward.execute(task, { config }); }
catch (err) {
  if (err instanceof BotwardError) { /* expected */ }
  else throw err;
}
```

### Named exports

```ts
import Botward, {
  BotwardError,
  type Config,
  type LLMClient,
  type AgentRunResult,
} from 'botward';
```

## Development

```bash
npm run dev         # run with tsx
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # bundle to dist/cli.js
```