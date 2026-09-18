# Built-in tools

Botward ships with a small set of common-purpose tools you can declare in your
config without writing any code. Just reference them by `name` and set
`permission` to scope what they can touch.

All built-in tools **deny by default** — if you forget to set `permission`,
the tool refuses every call. This is intentional: opt-in is safer than
opt-out for tools that touch the filesystem, network, or shell.

To use a built-in, declare it like any other tool but omit `code` and `file`:

```jsonc
{
  "tools": [{
    "name": "read_file",
    "description": "Read project source files",  // optional, has built-in default
    "inputSchema": { ... },                      // optional, has built-in default
    "permission": "src/**"                       // required — see syntax per tool below
  }]
}
```

## Permission syntax by tool

| Tool | Pattern format | Example |
|---|---|---|
| `read_file` / `write_file` / `list_files` / `search_files` | glob | `"src/**"`, `"/abs/path/*"` |
| `fetch_url` | URL pattern | `"https://api.example.com/*"` |
| `run_command` | command tokens | `"git *"`, `"npm install"`, `"python -m pytest *"` |

`permissionFile` (a path to a JSON array of strings) works the same way for
all built-ins: each entry follows the tool's pattern format. If you set both
`permission` and `permissionFile`, the effective allowlist is the union.

---

## read_file

Reads a file as UTF-8 text or base64.

**Input**
```ts
{
  path: string;                       // required
  encoding?: "utf-8" | "base64";      // default "utf-8"
}
```

**Output**
```ts
{ ok: true, path, bytes, content }
```

**Permission**: glob matched against the absolute path. Patterns like
`src/**`, `*.txt`, `/abs/path/*` all work. The directory containing `path`
must be reachable via the glob — write the pattern to match the directory
itself OR a parent.

**Default policy**: deny all.

---

## write_file

Writes text to a file (create or overwrite).

**Input**
```ts
{
  path: string;                       // required
  content: string;                    // required
  mode?: "overwrite" | "append";      // default "overwrite"
}
```

**Output**
```ts
{ ok: true, path, bytes, mode }
```

Creates intermediate directories on overwrite.

**Permission**: glob matched against the absolute path. The tool resolves
the path to absolute before checking.

**Default policy**: deny all.

---

## list_files

Lists files under a directory matching a glob.

**Input**
```ts
{
  pattern?: string;      // default "**/*", prepended with "**/" if no slash
  cwd?: string;          // default process cwd
  limit?: number;        // default 1000
}
```

**Output**
```ts
{ ok: true, cwd, pattern, count, truncated: false, files: string[] }
```

**Permission**: glob matched against `cwd`. `truncated` is always `false` in
v1 (when `count` exceeds `limit`, walking stops but we don't flag).

**Default policy**: deny all.

---

## search_files

Greps files under `cwd` for lines matching a substring or regex.

**Input**
```ts
{
  pattern: string;                    // required
  cwd?: string;                       // default cwd
  glob?: string;                      // default "**/*"
  regex?: boolean;                    // default false — treat pattern as substring
  caseSensitive?: boolean;            // default true
  maxResults?: number;                // default 100
}
```

**Output**
```ts
{
  ok: true,
  cwd,
  pattern,
  count,
  truncated: boolean,    // true if maxResults was hit
  matches: Array<{ file, line, text }>
}
```

Files larger than 1 MB are skipped (avoid loading them into memory).
Non-UTF-8 files are skipped silently.

**Permission**: glob matched against `cwd`.

**Default policy**: deny all.

---

## fetch_url

Fetches an HTTP/HTTPS URL.

**Input**
```ts
{
  url: string;                                          // required
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";  // default "GET"
  headers?: Record<string, string>;
  body?: string;                                        // ignored for GET/HEAD
}
```

**Output**
```ts
{
  ok: boolean,           // resp.ok
  status: number,
  statusText: string,
  url: string,          // final URL after redirects
  headers: Record<string, string>,
  body: string,          // utf-8
  bytes: number,
}
```

**Permission**: URL pattern. Examples:
- `"https://api.example.com/*"` — exact origin, any path
- `"https://*.example.com/**"` — any subdomain, any path
- `"https://*"` — any HTTPS host (loose)

**SSRF protection (built-in, not overridable via permission)**: requests to
private IPs (RFC1918, link-local, loopback, ULA, multicast) and `localhost`/
`*.local` hostnames are rejected even if a permission pattern matches. This
is best-effort: v1 does not resolve DNS to verify. A determined attacker
can DNS-rebind around this — for sensitive internal endpoints, deploy
botward behind a network policy that enforces the same restrictions.

**Default policy**: deny all (you must set `permission` to use this tool).

---

## run_command

Executes a shell command via `spawn(shell: true)`.

**Input**
```ts
{
  command: string;        // required, e.g. "git status"
  cwd?: string;
  timeoutMs?: number;     // default 30000
}
```

**Output**
```ts
{
  ok: boolean,            // exit code === 0
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
  truncated: boolean,     // output exceeded 1 MB combined
}
```

**Permission**: command pattern. Examples:
- `"git *"` — `git` plus any arguments
- `"git status"` — exact match
- `"npm install"` — exact, no trailing args allowed
- `"python -m pytest *"` — fixed prefix, trailing arg wildcard

When the pattern ends with `*`, the command can have any number of trailing
arguments. When it does not, the input must match the pattern exactly in
length.

**Default policy**: deny all (this is the most dangerous built-in — explicit
opt-in is required).

**Subprocess cleanup**: the command runs in a new process group. On
timeout, botward sends `SIGKILL` to the entire group, so children won't
leak. The 1 MB output cap protects the context window.

---

## Notes

- **Sandbox ≠ OS isolation.** The built-in tools use the host's `fs`,
  `child_process`, and `fetch`. They restrict *what tools can do*, not what
  *processes on the host can do*. Combine `permission` with OS-level
  restrictions (run as a non-root user, use a read-only filesystem mount,
  deploy behind a firewall) when exposing botward via webhook.
- **Permission errors become LLM feedback.** When a built-in denies a call,
  it throws with a clear reason. The agent loop catches the error and
  reports it as `isError: true` back to the model — so the LLM can usually
  recover (or be told explicitly that an action is forbidden).