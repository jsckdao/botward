# 内置工具

Botward 内置了一组常用工具，你可以在配置里直接按 `name` 引用、设置
`permission` 来限定它能触及的范围，无需写一行代码。

所有内置工具**默认拒绝** —— 忘了设 `permission`，工具就会拒绝所有调用。
这是有意为之：对于会触碰文件系统、网络或 shell 的工具，"显式 opt-in"
比"显式 opt-out"更安全。

要使用某个内置，**和声明普通工具一样**，但**省略 `code` 和 `file`**：

```jsonc
{
  "tools": [{
    "name": "read_file",
    "description": "读取项目源文件",  // 可选，有内置默认值
    "inputSchema": { ... },          // 可选，有内置默认值
    "permission": "src/**"           // 必填 —— 各工具语法不同，见下
  }]
}
```

## 各工具的 permission 语法

| 工具 | 表达式格式 | 例子 |
|---|---|---|
| `read_file` / `write_file` / `list_files` / `search_files` | glob | `"src/**"`, `"/abs/path/*"` |
| `fetch_url` | URL 模式 | `"https://api.example.com/*"` |
| `run_command` | 命令 token | `"git *"`, `"npm install"`, `"python -m pytest *"` |

`permissionFile`（指向 JSON 字符串数组的文件路径）对所有内置通用：数组里
每个元素遵循该工具的 pattern 格式。如果同时设了 `permission` 和
`permissionFile`，最终 allowlist 是两者的并集。

`permission` 也支持直接写字符串数组 —— 每个元素就是一条 allowlist 表达式
（语法跟单字符串一致）：

```json
{
  "name": "run_command",
  "permission": ["git *", "npm test", "ls *"]
}
```

这种写法跟同内容的 `permissionFile` 等效，只是写在 config 里 —— 适合
pattern 不多、又不想单独建一个文件的场景。数组里第一个元素会作为工具的
主 `expression`，其余追加到 `extraPatterns`。所有 pattern（inline + file）
按 OR 组合。

---

## read_file

以 UTF-8 文本或 base64 读取文件。

**输入**
```ts
{
  path: string;                       // 必填
  encoding?: "utf-8" | "base64";      // 默认 "utf-8"
}
```

**输出**
```ts
{ ok: true, path, bytes, content }
```

**权限**：glob，匹配绝对路径。`src/**`、`*.txt`、`/abs/path/*` 都行。glob
要能覆盖到 `path` 所在的目录 —— pattern 要么匹配目录本身，要么匹配某个
祖先。

**默认策略**：拒绝所有。

---

## write_file

写入文本到文件（创建或覆盖）。

**输入**
```ts
{
  path: string;                       // 必填
  content: string;                    // 必填
  mode?: "overwrite" | "append";      // 默认 "overwrite"
}
```

**输出**
```ts
{ ok: true, path, bytes, mode }
```

覆盖时会自动创建中间目录。

**权限**：glob，匹配绝对路径。工具在检查前会先把 `path` 解析为绝对路径。

**默认策略**：拒绝所有。

---

## list_files

列出目录下匹配 glob 的文件。

**输入**
```ts
{
  pattern?: string;      // 默认 "**/*"，无 `/` 时自动补 `**/`
  cwd?: string;          // 默认进程 cwd
  limit?: number;        // 默认 1000
}
```

**输出**
```ts
{ ok: true, cwd, pattern, count, truncated: false, files: string[] }
```

**权限**：glob，匹配 `cwd`。v1 中 `truncated` 始终为 `false`（达到 `limit`
时停止遍历，但不标记）。

**默认策略**：拒绝所有。

---

## search_files

在 `cwd` 下搜索匹配子串或正则的行。

**输入**
```ts
{
  pattern: string;                    // 必填
  cwd?: string;                       // 默认 cwd
  glob?: string;                      // 默认 "**/*"
  regex?: boolean;                    // 默认 false —— pattern 按子串匹配
  caseSensitive?: boolean;            // 默认 true
  maxResults?: number;                // 默认 100
}
```

**输出**
```ts
{
  ok: true,
  cwd,
  pattern,
  count,
  truncated: boolean,    // 达到 maxResults 时为 true
  matches: Array<{ file, line, text }>
}
```

超过 1 MB 的文件会被跳过（避免一次性读进内存）。非 UTF-8 文件静默跳过。

**权限**：glob，匹配 `cwd`。

**默认策略**：拒绝所有。

---

## fetch_url

发起 HTTP/HTTPS 请求。

**输入**
```ts
{
  url: string;                                          // 必填
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";  // 默认 "GET"
  headers?: Record<string, string>;
  body?: string;                                        // GET/HEAD 时忽略
}
```

**输出**
```ts
{
  ok: boolean,           // resp.ok
  status: number,
  statusText: string,
  url: string,          // 重定向后的最终 URL
  headers: Record<string, string>,
  body: string,          // utf-8
  bytes: number,
}
```

**权限**：URL pattern。例子：
- `"https://api.example.com/*"` —— 精确 origin, 任意 path
- `"https://*.example.com/**"` —— 任意子域, 任意 path
- `"https://*"` —— 任意 HTTPS host（宽松）

**SSRF 防护（内置，permission 不能覆盖）**：指向私有 IP（RFC1918、
link-local、loopback、ULA、组播）以及 `localhost`/`*.local` 主机名的请求
即使 permission pattern 匹配也会被拒绝。这是尽力而为的：v1 不解析 DNS
做校验。蓄意攻击者仍可通过 DNS rebinding 绕过 —— 对于敏感的内部端点，
在 botward 外部（防火墙、网络策略）做同样的限制。

**默认策略**：拒绝所有（必须设 `permission` 才能用）。

---

## run_command

通过 `spawn(shell: true)` 执行 shell 命令。

**输入**
```ts
{
  command: string;        // 必填，如 "git status"
  cwd?: string;
  timeoutMs?: number;     // 默认 30000
}
```

**输出**
```ts
{
  ok: boolean,            // exit code === 0
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  stdout: string,
  stderr: string,
  truncated: boolean,     // 合并输出超过 1 MB
}
```

**权限**：命令 pattern。例子：
- `"git *"` —— `git` 加任意参数
- `"git status"` —— 精确匹配
- `"npm install"` —— 精确，不允许额外参数
- `"python -m pytest *"` —— 固定前缀，末尾通配

pattern 以 `*` 结尾时，命令可以带任意数量的尾部参数。否则要求输入与
pattern 长度一致。

**默认策略**：拒绝所有（这是最危险的内置 —— 必须显式 opt-in）。

**子进程清理**：命令运行在新进程组里。超时时 botward 给整个进程组发
`SIGKILL`，子进程不会泄漏。1 MB 输出上限保护 context window。

---

## 注意

- **沙箱 ≠ 操作系统隔离。** 内置工具直接用宿主的 `fs`、`child_process`、
  `fetch`。它们限制的是**工具能做什么**，不是**宿主机上其他进程能做
  什么**。把 botward 暴露成 webhook 时，把 `permission` 与 OS 层限制
  一起用（非 root 用户运行、只读文件系统、防火墙后部署）。
- **权限错误会回到 LLM。** 内置工具拒绝时会抛出带清晰原因的错误。
  agent loop 捕获后作为 `isError: true` 报告给模型 —— 所以 LLM 通常能
  自我恢复（或者被明确告知某个动作被禁止）。