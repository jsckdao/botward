# 工具开发指南

本文档覆盖编写可在 botward 中运行的工具所需的一切：工具代码如何加载、
可用的运行时环境、输入输出如何处理、以及出问题时的调试方法。

如果你只想快速跑起来一个 agent，参考根目录的 README 和 `execute` 命令。
本文档面向的是想给 agent 扩展自定义能力的场景。

---

## 1. 什么是工具？

工具（tool）是一段 CommonJS 代码，LLM 可以在执行任务的过程中调用它。当
模型决定使用某个工具时，botward 会在沙箱化的 VM 上下文中执行该工具的
`run(input)` 函数，把返回值 JSON 序列化后喂回模型的上下文。

工具在 botward 配置文件中声明（`botward.json`），可以是内联代码
（`tools[].code`）或外部文件（`tools[].file`）。

---

## 2. 两种交付方式

```jsonc
{
  "tools": [
    // 内联 —— 适合短工具、原型、临时任务
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

    // 外部文件 —— 任何稍具规模的工具
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

规则：

- `code` 或 `file` **必须且只能有一个**。两者都写或都不写都会被配置
  schema 拒绝。
- `file` 中的相对路径（以及 `skills[].dir`）都相对于**配置文件所在目录**
  解析，而不是 `process.cwd()`。这一点在 `botward serve` 从不同 cwd
  调用时尤其重要。
- `name` 在所有工具间必须唯一。LLM 用这个名字原样发起调用。
- `description` 会展示给模型 —— 把它写成一行规格说明："工具做什么" +
  "什么时候用" + "返回什么"。

---

## 3. 执行环境

botward 使用 Node 的 `vm` 模块加载每个工具的代码，并通过
`module.createRequire` 合成一个真实的 CommonJS 上下文。你能拿到：

### 可用项

| 名称 | 说明 |
|---|---|
| `module`、`exports`、`require(...)` | 真实的 CJS。`require` 锚定到工具文件路径，所以相对路径和 `node_modules` 解析都能正常工作。 |
| `__filename`、`__dirname` | 真实文件路径（内联 `code` 时是合成的）。 |
| `process`、`console` | 宿主进程。日志输出到 stderr。 |
| `Buffer`、`URL`、`URLSearchParams` | 标准全局对象。 |
| `TextEncoder`、`TextDecoder` | 标准全局对象。 |
| `setTimeout`、`setInterval`、`setImmediate`、`clearTimeout`、`clearInterval`、`clearImmediate` | 标准定时器。 |

### 能 `require` 什么

因为 `require` 是 Node 原生的 `require`，你可以引入：

- Node 内置模块：`node:fs`、`node:path`、`node:crypto`、`node:http`、`node:https`……
- botward 安装目录里 `node_modules` 的任何包（如 `axios`、`lodash`、`nanoid`）。
- 工具同目录的相对文件：`require('./helpers')`。

### 不能 `require` 什么

- **纯 ESM 包不能 `require`** —— 它们需要动态 `import()`，而当前沙箱**不支持**
  `import`。请在工具中使用 CJS 友好的包。
- **工具之间不能直接互相调用** —— 工具只通过输入输出契约沟通，不通过
  函数调用。

### 资源限制（默认值）

| 限制 | 默认值 | 可按工具覆盖？ |
|---|---|---|
| 编译超时（解析 + `code`/`file` 初次执行） | **10 秒** | 否，硬编码 |
| 单次执行超时 | **30 秒** | 可以 —— `timeoutMs` |
| 输出字节上限（超出后截断） | **50,000 字节** | 可以 —— `maxOutputBytes` |

当工具运行超过 `timeoutMs`（或默认 30 秒）时，botward 把它当作错误，
以 `isError: true` 喂回 LLM。循环不会崩溃，模型通常能自我恢复。

---

## 4. 工具导出形式

任选其一 —— botward 会统一规范化。

### 形式 A —— 直接导出函数（最简单）

```js
module.exports = async function fetchUrl({ url }) {
  const res = await fetch(url);
  return { status: res.status, body: await res.text() };
};
```

### 形式 B —— `{ run }` 对象（推荐）

允许你在文件内部覆盖 `name`、`description`、`inputSchema` —— 当你有
多个工具共享一个基类文件时很有用：

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

文件里导出的字段会覆盖配置文件中的值 —— 配置里的 `name`/
`description`/`inputSchema` 是兜底。

### 形式 C —— `{ default }` 对象（互操作用）

适用于原本用 ESM 写然后被转译的工具，或者匹配你的打包器输出：

```js
module.exports = { default: async ({ msg }) => ({ echoed: msg }) };
```

### 同步 vs 异步

推荐 `async`（返回 Promise）。botward 会 `await` 结果；同步函数也能跑，
只是失去超时/取消的钩子。

---

## 5. `input` 参数

模型会传给你一个参数 —— 一个对象，其结构匹配你定义的 `inputSchema`。
botward **不会**在运行时校验输入是否匹配 schema（默认信任模型会传
格式正确的数据）。你拿到的就是模型实际产出的内容。

实际意义：

- **始终用默认值解构**，以防万一：
  ```js
  module.exports = async ({ url = '', method = 'GET', headers = {} } = {}) => { ... };
  ```
- 如果模型传了乱七八糟的内容，你的工具抛错，botward 捕获错误，并以
  `isError: true` 报告给模型。模型通常会在下一轮自己修正。

---

## 6. 返回值

你的返回值会用 2 空格缩进进行 JSON 序列化，然后送回模型。三条规则：

1. **必须是可 JSON 序列化的。** 循环引用、`BigInt`、`Function` 等会让
   `JSON.stringify` 抛错，并被当作错误返回。普通对象、数组、字符串、
   数字、布尔、null —— 都行。
2. **超过 `maxOutputBytes` 会被截断**，并附上 `...[truncated N bytes]`
   标记。默认 50 KB；可通过 `maxOutputBytes` 在配置里覆盖。
3. **不要返回大对象。** 50 KB 的响应会占掉 context window 相当一块。
   如果你的工具天然会产生大量输出，考虑分块返回，或拆成多次小调用。

返回 `null` 或 `undefined` 都会被序列化成字符串 `"null"`。如果想要清晰
信号，返回 `{ ok: true }` 这类对象。

---

## 7. 配置项参考

```jsonc
{
  "tools": [{
    "name": "my-tool",                  // 必填
    "description": "What it does",      // 必填
    "inputSchema": { ... },             // JSON Schema；默认为 {}
    "code": "...",                      // code 和 file 必有其一
    "file": "tools/my-tool.cjs",
    "timeoutMs": 30000,                 // 可选，默认 30000
    "maxOutputBytes": 50000,            // 可选，默认 50000

    // 可选权限字段 —— 见下文 "权限" 一节
    // 语法由工具自己定义. 内置工具会强制执行 (见 docs/zh/builtin-tools.md)
    // 用户工具通过 run(args, perms) 第二个参数收到, 是否使用自愿
    "permission": "...",                // 可选，单条表达式
    "permissionFile": "perms/my.json"   // 可选，JSON 字符串数组
  }]
}
```

`inputSchema` 遵循标准 JSON Schema Draft 2020-12 语法。Anthropic 和
OpenAI 都接受一个有用的子集 —— 尽量只用 `type`、`properties`、`required`、
`enum`、`description`。除非你已经测试过，否则避免使用 `$ref`、`oneOf`、
`allOf` 这类花式关键字。

### 7a. 权限（`permission` 与 `permissionFile`）

这两个可选字段存在于每个工具上。它们是**工具自定义的**：每个工具自行决定
`permission` 表达式的含义。内置工具（read_file、write_file、fetch_url、
run_command 等）有自己的语法 —— 见 [`docs/zh/builtin-tools.md`](./builtin-tools.md)。
用户工具通过 `run` 的第二个参数收到解析后的 payload：

```js
module.exports = async (args, permissions) => {
  // permissions 未设置时为 undefined;
  // 否则形如 { expression?, extraPatterns: string[], filePath? }
  if (!permissions?.expression?.includes(args.action)) {
    throw new Error('action not in permission allowlist');
  }
  // ... 干活
};
```

如果 `permission` 和 `permissionFile` 都设了，两个都生效 —— 最终 allowlist
是两者的并集（OR）。

如果都不设，用户工具收到 `permissions === undefined`，爱怎么做策略都行。
内置工具走 **默认拒绝** 策略 —— 必须显式 opt-in。

`permissionFile` 中的路径**相对于配置文件所在目录**解析，与 `file` 字段
一致。文件必须是 JSON 字符串数组。

---

## 8. 端到端示例

一个通过 webhook 发 Slack 消息的工具：

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

## 9. 调试

日志输出到 **stderr**（stdout 留给 agent 的最终文本，保持可管道化）。

| 你看到的 | 位置 | 含义 |
|---|---|---|
| `[botward] loading config: ...` | stderr | 配置文件路径解析 |
| `[botward] config "X" (provider=Y)` | stderr | 配置加载完成 |
| `[botward] tool: <name> -> <preview>` | stderr | 每次工具调用：工具名 + 输出前 200 字符 |
| `[botward] warn: ...` | stderr | 非致命警告（例如 LLM 请求了未注册的工具） |
| `[botward] error: ...` | stderr | 工具抛错；已把 `isError: true` 喂回模型 |
| `Error: ...`（由 CLI 入口打印） | stderr | 不可恢复的失败（配置非法、缺 API key 等） |

小贴士：

- 工具里的 `console.log` 也会到 stderr —— 放心用。
- 想看模型具体传了什么，可以临时在 `run` 顶部加
  `console.error(JSON.stringify(arguments))`。
- 工具反复超时，可以在配置里调大 `timeoutMs` —— 但也想想能否把工作
  拆成多次更小的工具调用。

---

## 10. 沙箱安全性 —— 暴露 webhook 前必读

工具以**你**的 botward 进程的权限运行。宿主能做的任何事，你的工具都能
做。如果你把 `botward serve` 暴露到公网：

- **必须先鉴权** —— 永远不要让 botward 直接对外暴露。
- **锁定工具版本** —— 工具会 `require()` `node_modules`，依赖被投毒
  就等于代码执行。
- **避免 shell 调用的工具** —— `child_process` 让工具能做宿主用户
  能做的任何事。
- **不要把密钥放在工具代码里** —— 它躺在磁盘上。请用 `process.env`
  并通过 botward 进程的环境注入。

botward 的 vm 沙箱隔离的是 **JavaScript 上下文**，不是 **操作系统**。
沙箱的作用是防止意外的无限循环和工具间的命名空间冲突，**不是**用来跑
不可信代码的。