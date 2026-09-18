# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # run TS sources via tsx (e.g. npm run dev -- execute "..." -c botward.json)
npm run build       # bundle to dist/cli.js with tsup
npm run start       # run the built bundle
npm run typecheck    # tsc --noEmit
npm test            # vitest run (one-shot)
npm run test:watch  # vitest in watch mode
```

Run a single test file:
```bash
./node_modules/.bin/vitest run tests/builtin/read-file.test.ts
```

Run a single test by name (substring match against the `it` title):
```bash
./node_modules/.bin/vitest run -t "denies when"
```

`scripts/smoke-*.ts` are throwaway end-to-end scripts run via `./node_modules/.bin/tsx scripts/smoke-X.ts`. They're not tests but useful for poking at the system with stub SDKs or fake API keys.

## Architecture

Botward is a single-task AI agent CLI: each invocation loads a config (`botward.json`), spins up an agent, runs tool calls until the LLM stops requesting tools, prints the final assistant text to stdout, and exits. No persistent memory between invocations.

The data flow for `botward execute`:

```
config ─▶ loader ─▶ LoadedTool[]
                       │
systemPrompt ─┐         │
skills    ───┼─▶ composeSystemPrompt ─▶ system string
                       │
                       ▼
              agent loop (runAgent)
                    LLM ─▶ tool_calls ─▶ tools.run(args, permissions)
                                              └─▶ result ─▶ back to LLM
                                                            (loop until no tool_calls)
```

### Module map

- `src/cli/` — commander wiring (`index.ts`) + per-command handlers (`commands/execute.ts`, `commands/init.ts`)
- `src/config/` — zod schemas (`schema.ts`) + JSON loader (`loader.ts`) + path resolver (`paths.ts`)
- `src/llm/` — provider abstraction. `types.ts` defines the unified `LLMClient`/`UnifiedMessage` types; `anthropic.ts` and `openai.ts` translate to/from their respective SDKs; `factory.ts` picks based on `config.provider`
- `src/agent/` — `loop.ts` (the agent loop) + `prompt.ts` (system prompt composition with skills)
- `src/skills/` — loads inline `content` or directory `dir` (with `SKILL.md` front-matter)
- `src/tools/` — `sandbox.ts` (vm + createRequire for CJS tools), `loader.ts` (dispatch), `registry.ts` (built-in name set)
  - `builtin/` — six built-in tools (`read_file`, `write_file`, `list_files`, `search_files`, `fetch_url`, `run_command`), plus `matchers/` (glob/url/command), `permissions.ts` (parser for `permission` / `permissionFile`)
- `src/init/` — `prompt.ts` + `generator.ts` (generate-validate-feedback loop) for `botward init`

### Tools: built-in vs user

`loader.ts` dispatches each `ToolConfig`:

- If `name` is in `BUILTIN_TOOL_NAMES` (in `tools/builtin/registry.ts`), it calls the registered factory with resolved permissions and returns a `LoadedTool`. The factory's closure captures the permissions payload.
- Otherwise it requires `code` or `file`, compiles via `vm.Script` with `createRequire`, and wraps the user's `run(args)` as `(args, _perms) => fn(args)` so the second arg is silently ignored.

### Permissions model

Every `ToolConfig` has two optional fields:

- `permission` — single string expression
- `permissionFile` — path to a JSON array of strings (resolved relative to config dir)

These are parsed at load time by `tools/builtin/permissions.ts` into a `ResolvedPermissions` (`{ expression?, extraPatterns[], filePath? }`) and attached to `LoadedTool.permissions`. The agent loop forwards this to `tool.run(args, permissions)`.

- Built-in tools **default-deny**: missing `permission` means no calls allowed. Each tool defines its own expression format (glob for files, URL pattern for fetch, command tokens for run).
- User tools receive the payload via the second `run` arg and decide what to do.

### ESM initialization order trap

`tools/builtin/registry.ts` declares `registerBuiltin` and the `BUILTIN_TOOL_NAMES` set, but **does not** import the tool factory files. Doing so would be a circular init: tool files call `registerBuiltin` at top level, but ESM imports are hoisted, so the function wouldn't exist yet when the tool module evaluates.

The side-effect imports live in `tools/builtin/registry-imports.ts`, which itself imports `registry.js` first to force its body to run before the tool factories load. `loader.ts` imports `registry-imports.js` to wire everything up.

When testing a built-in directly, the test must `import '../../src/tools/builtin/tools/<name>.js'` to trigger registration — `getBuiltinTool('read_file')` throws "not registered" otherwise.

### Skills

Two modes:
- `content` — string appended to system prompt under `## Skill: <name>`
- `dir` — path to a folder; loader reads `SKILL.md`, parses front-matter for `name`/`description` overrides, and uses the body. Sibling files are not auto-loaded.

### Provider abstraction

Both Anthropic and OpenAI require `model` on every request — neither SDK supports defaults. Our adapters supply hardcoded defaults (`claude-sonnet-4-5` / `gpt-4o-mini`) overridable via `config.model` or `--model`. For `init`, the env vars `BOTWARD_MODEL_ANTHROPIC` / `BOTWARD_MODEL_OPENAI` are also consulted.

Differences between providers (translated inside each adapter, never leaks upward):

| Concept | Anthropic | OpenAI |
|---|---|---|
| Tool def | `input_schema` | wrapped in `{type:'function', function:{...}}` |
| Assistant tool calls | content blocks with `type:'tool_use'` | `message.tool_calls[]` with `function.arguments` as JSON string |
| Tool results | `role:'user'` + `tool_result` blocks | `role:'tool'` per result |
| System prompt | top-level `system` | first `role:'system'` message |

## Conventions

- All paths in `permission`/`file`/`skills[].dir` resolve relative to the **config file's directory**, not cwd. Use `resolveFromConfig` in `config/paths.ts`.
- Strict TS: `strict: true`, `noUnusedLocals`, `noUnusedParameters`. No `any` leaks in new code unless interfacing with the SDKs.
- Errors throw `BotwardError` (in `utils/errors.ts`); the CLI entry catches and prints to stderr. The agent loop catches tool errors and feeds them back to the LLM as `isError: true` so the model can recover.
- Output goes to stdout; logs go to stderr via `utils/logger.ts`. This keeps the CLI pipe-friendly.
- Tests live next to the feature: `tests/builtin/` for built-ins, `tests/*.test.ts` for cross-cutting. Use Vitest. Mocks are hand-implemented classes (e.g. `ScriptedLLM` in `tests/loop.test.ts`), no library.

## Reference

- `README_ZH.md` — the canonical config schema (Chinese) — README.md mirrors it in English
- `docs/tools-dev.md` and `docs/zh/tools-dev.md` — how to write user tools (CJS export shapes, input/output handling, sandbox limits, security caveats)
- `docs/builtin-tools.md` and `docs/zh/builtin-tools.md` — built-in tool reference (input schemas, permission syntax per tool, default policies)
- `docs/builtin-tools.md#fetch_url` — SSRF protection notes (v1 is host-pattern-based, not DNS-resolved)