# Botward

Botward is an extremely simple AI agent, primarily positioned to handle
specific single tasks that don't require human supervision — for example,
acting as a handler for webhooks from external services.

It is **not** designed as a general-purpose agent, nor even one that retains
long-term complex memory. Its memory system only exists to complete a single
task.

It is simple to use: you can easily spawn multiple agent instances locally
in parallel to execute tasks concurrently.

中文 README 见 [README_ZH.md](README_ZH.md)

## Quick start

```bash
# Install
npm install botward -g

# Run a task with a config file
botward execute "summarize the README" -c tests/fixtures/basic.json

```

## Config file

```json
{
  "name": "Botward",
  "version": "0.1.0",
  "description": "A chatbot for developers",
  "systemPrompt": "You are a ....",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "maxIterations": 50,
  "maxContextLength": "256k",
  "maxContextLengthRatio": 0.9,
  "contextCompression": true,
  "skills": [{
    "name": "webDev",
    "description": "A skill for web development",
    "content": "...",
    "dir": "path/to/skill/dir"
  }],
  "tools": [{
    "name": "read_file",
    "description": "Read a file from the workspace",
    "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } } },
    "permission": "workspace/*/*.js",
    "code": "// cjs code ...",
    "file": "tools/read_file.cjs"
  }]
}
```

### Top-level fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | required | Project name |
| `version` | string | `"0.0.0"` | Version |
| `description` | string? | — | Description |
| `systemPrompt` | string? | — | System prompt |
| `provider` | `"anthropic"` \| `"openai"` | `"anthropic"` | LLM provider |
| `model` | string? | SDK default | Model name |
| `maxIterations` | number (positive int) | `50` | Hard cap on agent loop turns per task |
| `contextCompression` | boolean | `true` | Enable context compression (see below) |
| `maxContextLength` | string \| number | `262144` (≈256k) | Input token budget; accepts `"256k"`, `"1m"`, or raw integer |
| `maxContextLengthRatio` | number (0.1–0.99) | `0.9` | Threshold ratio that triggers compression |
| `skills` | Skill[] | `[]` | Skill list (see below) |
| `tools` | Tool[] | `[]` | Tool list (see below) |

### Context compression

When the previous response's `inputTokens >= maxContextLength * maxContextLengthRatio`, the next request compresses older history first:

- Always preserved: `systemPrompt`, skill list, tool list, user task
- Last 3 turns of tool calls (assistant tool_use + user tool_result) kept verbatim
- Older history sent for LLM summary, inserted as a single prose message before the kept-recent block
- Summary call failures are warned-and-skipped; the next iteration retries

Anthropic / OpenAI prompt cache invalidates once after compression (prefix changes), then rebuilds on the next call.

### Skill

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | ✓ | Skill name |
| `description` | string | — | Description, default `""` |
| `content` | string? | — | Inline content; at least one of `content` / `dir` is required; `content` wins when both are set |
| `dir` | string? | — | Path to a skill directory; the loader reads `<dir>/SKILL.md` |

### Tool

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | ✓ | Tool name; if it matches a built-in (`read_file`, etc.), `code`/`file` are optional |
| `description` | string | — | Description, default `""` |
| `inputSchema` | object | — | JSON schema for the input, default `{ type: 'object', properties: {}, additionalProperties: true }` |
| `code` | string? | * | Inline CJS source (mutually exclusive with `file`; required for non-built-in tools) |
| `file` | string? | * | Path to a CJS file (mutually exclusive with `code`) |
| `maxOutputBytes` | number? | — | Hard cap on tool output bytes (protects the context window) |
| `timeoutMs` | number? | — | Per-call `run()` timeout in milliseconds |
| `permission` | string \| string[]? | — | Permission expression; syntax defined per tool |
| `permissionFile` | string? | — | Path to a JSON array of permission expressions |

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