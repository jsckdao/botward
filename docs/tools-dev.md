# Tools development

This guide covers everything you need to build a tool that runs inside botward:
how tool source code is loaded, what runtime is available, how input/output is
handled, and how to debug when something goes wrong.

If you want a working agent quickly, see the README and the `execute` command.
This doc is for when you want to extend the agent with custom capabilities.

---

## 1. What is a tool?

A tool is a piece of CommonJS code that the LLM can call mid-task. When the
model decides to use a tool, botward executes the tool's `run(input)` function
inside a sandboxed VM context, JSON-serializes the return value, and feeds it
back into the model's context.

You declare tools in the botward config file (`botward.json`), either inline
under `tools[].code` or as a separate file under `tools[].file`.

---

## 2. The two ways to ship a tool

```jsonc
{
  "tools": [
    // Inline — short tools, prototype, throwaway
    {
      "name": "echo",
      "description": "Echo back the input",
      "inputSchema": {
        "type": "object",
        "properties": { "msg": { "type": "string" } },
        "required": ["msg"]
      },
      "code": "module.exports = async ({ msg }) => ({ echoed: msg });"
    },

    // External file — anything non-trivial
    {
      "name": "fetch-url",
      "description": "Fetch a URL and return the response body",
      "inputSchema": {
        "type": "object",
        "properties": { "url": { "type": "string", "format": "uri" } },
        "required": ["url"]
      },
      "file": "tools/fetch-url.cjs"
    }
  ]
}
```

Rules:

- Exactly **one** of `code` or `file`. Not both, not neither — the config
  schema rejects anything else.
- Relative paths in `file` (and `skills[].dir`) are resolved **against the
  directory of the config file**, not `process.cwd()`. This matters when
  `botward serve` is invoked from a different cwd.
- `name` must be unique across tools. The LLM uses the name verbatim to
  request a call.
- `description` is shown to the model — write it like a one-line spec:
  "what this tool does" + "when to use it" + "what it returns".

---

## 3. Execution environment

Botward loads each tool's code with Node's `vm` module and synthesizes a real
CommonJS context using `module.createRequire`. You get:

### Available

| Name | Notes |
|---|---|
| `module`, `exports`, `require(...)` | Real CJS. `require` is rooted at the tool's file path, so relative paths and `node_modules` resolution work. |
| `__filename`, `__dirname` | Set to the actual file path (or synthesized for inline `code`). |
| `process`, `console` | The host process. Logs go to stderr. |
| `Buffer`, `URL`, `URLSearchParams` | Standard globals. |
| `TextEncoder`, `TextDecoder` | Standard globals. |
| `setTimeout`, `setInterval`, `setImmediate`, `clearTimeout`, `clearInterval`, `clearImmediate` | Standard timers. |

### What you can `require`

Because `require` is a real Node `require`, you can pull in:

- Node built-ins: `node:fs`, `node:path`, `node:crypto`, `node:http`, `node:https`, ...
- Anything in `node_modules` from the botward install (e.g. `axios`, `lodash`, `nanoid`).
- Relative files next to your tool: `require('./helpers')`.

### What's NOT available

- **ESM-only packages cannot be `require`d** — they need dynamic `import()`,
  which is currently NOT supported in the sandbox. Use CJS-friendly packages
  in tools.
- **Other tools are not directly accessible** — tools communicate only through
  their input/output contract, not by calling each other.

### Resource limits (default)

| Limit | Default | Override per-tool? |
|---|---|---|
| Compile timeout (parsing + initial execution of `code`/`file`) | **10s** | No — hardcoded |
| Per-call execution timeout | **30s** | Yes — `timeoutMs` |
| Max output bytes (truncate after this) | **50,000 bytes** | Yes — `maxOutputBytes` |

When a tool's run exceeds `timeoutMs` (or the default 30s), botward treats it
as an error and feeds `isError: true` back to the LLM. The loop does not
crash. The model can usually recover.

---

## 4. Tool export shapes

Pick whichever you prefer — botward normalizes them all.

### Form A — direct function (simplest)

```js
module.exports = async function fetchUrl({ url }) {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
};
```

### Form B — `{ run }` object (recommended)

Lets you also override `name`, `description`, `inputSchema` from inside the
file — useful when you have many tools sharing a base file:

```js
module.exports = {
  name: 'fetch-url',
  description: 'Fetch a URL and return its body as text',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', format: 'uri' } },
    required: ['url'],
  },
  run: async ({ url }) => {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  },
};
```

Fields from the export override the values in the config — the config's
`name`/`description`/`inputSchema` are fallbacks.

### Form C — `{ default }` object (interop)

For tools written originally as ESM and transpiled, or to match what your
bundler spits out:

```js
module.exports = { default: async ({ msg }) => ({ echoed: msg }) };
```

### Sync vs async

Use `async` (return a Promise). Botward awaits the result; sync returns work
too but you'll miss easy timeout/cancellation hooks.

---

## 5. The `input` argument

The model passes you a single argument — an object whose shape matches your
`inputSchema`. Botward does **not** validate the input against the schema at
runtime (the model is trusted to send well-formed input). What you receive is
literally what the model produced.

Practical implications:

- **Always destructure with defaults** for safety:
  ```js
  module.exports = async ({ url = '', method = 'GET', headers = {} } = {}) => { ... };
  ```
- If the model sends garbage, your tool crashes, the error is caught by
  botward, and reported back to the model as `isError: true`. The model can
  usually fix itself on the next turn.

---

## 6. Return values

Your return value is JSON-serialized with 2-space indent and sent back to the
model. Three rules:

1. **Must be JSON-serializable.** Anything circular, `BigInt`, `Function`,
   etc. will throw inside `JSON.stringify` and be reported as an error.
   Plain objects, arrays, strings, numbers, booleans, null — fine.
2. **Over `maxOutputBytes`, botward truncates** with a `...[truncated N bytes]`
   marker. Default 50 KB; override with `maxOutputBytes` in the config.
3. **Don't return huge blobs.** A 50 KB response eats a noticeable chunk of
   the context window. If your tool naturally produces a lot of output,
   summarize or stream chunks back across multiple turns instead.

Returning `null` or `undefined` both serialize as the string `"null"`. Return
an object like `{ ok: true }` if you want a clear signal.

---

## 7. Configuration reference

```jsonc
{
  "tools": [{
    "name": "my-tool",                  // required
    "description": "What it does",      // required
    "inputSchema": { ... },             // JSON Schema; defaults to {}
    "code": "...",                      // exactly one of code / file
    "file": "tools/my-tool.cjs",
    "timeoutMs": 30000,                 // optional, default 30000
    "maxOutputBytes": 50000,            // optional, default 50000

    // Optional permission fields — see "Permissions" below.
    // Syntax is tool-defined. Built-in tools honor these (see
    // docs/builtin-tools.md); user tools receive them in `run(args, perms)`
    // but are free to ignore them.
    "permission": "...",                // optional, single expression
    "permissionFile": "perms/my.json"   // optional, JSON array of strings
  }]
}
```

`inputSchema` follows standard JSON Schema Draft 2020-12 syntax. Both
Anthropic and OpenAI accept a useful subset — stick to `type`, `properties`,
`required`, `enum`, `description`. Avoid exotic keywords (`$ref`, `oneOf`,
`allOf`) unless you've tested them with your provider.

### 7a. Permissions (`permission` and `permissionFile`)

These two optional fields exist on every tool. They are **tool-defined**:
each tool decides what its `permission` expression means. Built-in tools
(read_file, write_file, fetch_url, run_command, ...) have their own
syntax — see [`docs/builtin-tools.md`](./builtin-tools.md). User tools
receive the resolved payload via the second argument of `run`:

```js
module.exports = async (args, permissions) => {
  // permissions is undefined if neither field is set;
  // otherwise { expression?, extraPatterns: string[], filePath? }
  if (!permissions?.expression?.includes(args.action)) {
    throw new Error('action not in permission allowlist');
  }
  // ... do work
};
```

If both `permission` and `permissionFile` are set, both apply — the
effective allowlist is the union (OR).

If neither is set, user tools receive `permissions === undefined` and
are responsible for any policy they want to enforce. Built-in tools apply
a **default-deny** policy when no permission is set (you must opt in).

Paths inside `permissionFile` are resolved **relative to the config file's
directory**, the same as `file`. The file must be a JSON array of strings.

---

## 8. End-to-end example

A tool that sends a Slack message via webhook:

**`tools/slack.cjs`**
```js
module.exports = {
  name: 'slack-post',
  description: 'Post a message to a Slack incoming webhook URL',
  inputSchema: {
    type: 'object',
    properties: {
      webhookUrl: { type: 'string', description: 'Slack webhook URL' },
      text: { type: 'string', description: 'Message text (Slack mrkdwn)' },
    },
    required: ['webhookUrl', 'text'],
  },
  run: async ({ webhookUrl, text }) => {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`slack ${res.status}: ${await res.text()}`);
    }
    return { ok: true };
  },
};
```

**`botward.json`**
```json
{
  "name": "Slack notifier",
  "provider": "anthropic",
  "systemPrompt": "You read issues from a JSON file and post a Slack summary for each.",
  "tools": [
    {
      "name": "slack-post",
      "description": "Post a Slack message",
      "inputSchema": {
        "type": "object",
        "properties": {
          "webhookUrl": { "type": "string" },
          "text": { "type": "string" }
        },
        "required": ["webhookUrl", "text"]
      },
      "file": "tools/slack.cjs"
    }
  ]
}
```

```bash
ANTHROPIC_API_KEY=sk-... \
botward execute "read issues.json and post a summary to #bot-updates"
```

---

## 9. Debugging

Logs go to **stderr** (stdout is reserved for the agent's final text — keep
it pipe-friendly).

| What you see | Where | Meaning |
|---|---|---|
| `[botward] loading config: ...` | stderr | Config path resolution |
| `[botward] config "X" (provider=Y)` | stderr | Config loaded |
| `[botward] tool: <name> -> <preview>` | stderr | Each tool call: name + first 200 chars of output |
| `[botward] warn: ...` | stderr | Non-fatal warning (e.g. unknown tool requested) |
| `[botward] error: ...` | stderr | Tool threw an error; `isError: true` was fed back |
| `Error: ...` (printed by CLI entry) | stderr | Unrecoverable failure (config invalid, API key missing, etc.) |

Tips:

- `console.log` inside a tool goes to stderr — use it freely.
- To see exactly what the model sent, run with `BOTWARD_LOG_MESSAGES=1` (TODO)
  or temporarily add `console.error(JSON.stringify(arguments))` at the top of
  `run`.
- If a tool keeps timing out, raise `timeoutMs` in the config — but also ask
  whether the work can be split across multiple smaller tool calls.

---

## 10. Sandbox security — read this before exposing via webhook

Tools run with **your** botward process's privileges. Anything the host can
do, your tool can do. If you expose `botward serve` to the public internet:

- **Authenticate callers** — never expose botward without an upstream auth
  layer.
- **Pin tool versions** — your tools `require()` from `node_modules`, so a
  compromised dependency is a code-execution vector.
- **Avoid tools that shell out** — `child_process` lets a tool do anything
  the host user can.
- **Don't put secrets in tool code** — they live on disk. Use `process.env`
  and pass them in via the botward process's environment.

Botward's vm sandbox isolates the *JavaScript context*, not the *OS*. The
sandbox is for safety against accidental infinite loops and namespace
collisions between tools, **not** for running untrusted code.