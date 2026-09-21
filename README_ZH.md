# Botward

Botward 是一个非常简单的 AI agent, 主要定位于处理那些不需要人类监督的特定单独任务 —— 比如作为外部服务 webhook 的处理器.

它**并不是**一个通用智能体, 也不是一个能保留长期复杂记忆的智能体. 它的记忆系统仅用于完成一个单独的任务.

它使用简单: 你可以很方便地在本地并行唤起多个 agent 实例来同时执行任务.

## 快速开始

```bash
# 安装
npm install botward -g

# 用配置文件跑一个任务
botward execute "summarize the README" -c tests/fixtures/basic.json

```

## 配置文件

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

### 顶层字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `name` | string | 必填 | 项目名 |
| `version` | string | `"0.0.0"` | 版本号 |
| `description` | string? | — | 描述 |
| `systemPrompt` | string? | — | 系统提示词 |
| `provider` | `"anthropic"` \| `"openai"` | `"anthropic"` | LLM provider |
| `model` | string? | SDK 默认 | 模型名 |
| `maxIterations` | number (正整数) | `50` | agent 单次任务最大循环轮数 |
| `contextCompression` | boolean | `true` | 是否启用上下文压缩（详见下文） |
| `maxContextLength` | string \| number | `262144` (≈256k) | 输入 token 总预算，支持 `"256k"` / `"1m"` / 纯数字 |
| `maxContextLengthRatio` | number (0.1–0.99) | `0.9` | 触发压缩的阈值比例 |
| `skills` | Skill[] | `[]` | 技能列表（详见下文） |
| `tools` | Tool[] | `[]` | 工具列表（详见下文） |

### 上下文压缩

当上一轮响应的 `inputTokens >= maxContextLength * maxContextLengthRatio` 时，下一轮请求之前会先压缩老历史：

- 永远保留：`systemPrompt`、技能列表、工具列表、用户原始任务
- 保留最近 3 轮工具调用（assistant tool_use + user tool_result）原样
- 更早的历史交给 LLM 压缩为一段 prose summary，插入到保留块前面
- 摘要调用失败时仅警告，本轮跳过压缩，下一轮再试

Anthropic / OpenAI 的 prompt cache 会在压缩后失效一次（前缀变化），下一轮重新写入。

### Skill

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | 技能名 |
| `description` | string | — | 描述，默认 `""` |
| `content` | string? | — | 内联内容；与 `dir` 至少填一个，填了 `content` 时优先用它 |
| `dir` | string? | — | 技能目录路径；loader 读 `<dir>/SKILL.md` |

### Tool

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✓ | 工具名；如果是内置名（`read_file` 等），可不填 `code`/`file` |
| `description` | string | — | 描述，默认 `""` |
| `inputSchema` | object | — | 输入的 JSON schema，默认 `{ type: 'object', properties: {}, additionalProperties: true }` |
| `code` | string? | * | 内联 CJS 代码（与 `file` 二选一；非内置工具必须填其中一个） |
| `file` | string? | * | CJS 文件路径，与 `code` 二选一 |
| `maxOutputBytes` | number? | — | 工具输出硬上限（字节），保护上下文窗口 |
| `timeoutMs` | number? | — | 单次 `run()` 调用超时（毫秒） |
| `permission` | string \| string[]? | — | 权限表达式，语法由各 tool 决定 |
| `permissionFile` | string? | — | 权限表达式列表的 JSON 文件路径 |

## 命令

| 命令 | 状态 | 说明 |
|---|---|---|
| `botward execute <task> [-c config]` | ✅ | 跑一个单独任务后退出 |
| `botward init <req> [-o output]` | ✅ | AI 自动生成多文件 botward 项目 (主配置 + tools/*.cjs + skills/*) |
| `botward chat [-c config]` | 🚧 计划中 | 交互式 REPL |
| `botward serve [-c config] [-p port] [--workers n]` | 🚧 计划中 | HTTP 服务化任务 |

## 环境变量

- `ANTHROPIC_API_KEY` — 当 config 的 `provider` 为 `anthropic` 时必填
- `OPENAI_API_KEY` — 当 config 的 `provider` 为 `openai` 时必填
- `ANTHROPIC_BASE_URL` — 可选, 覆盖 Anthropic API 端点
- `OPENAI_BASE_URL` — 可选, 覆盖 OpenAI API 端点
- `BOTWARD_MODEL_ANTHROPIC` / `BOTWARD_MODEL_OPENAI` — 可选, 覆盖 `init` 的默认模型

`botward init` 需要 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` 至少设一个; 命令会自动检测用哪个 provider.

## `botward init`

`init` 复用了与 `execute` 相同的引擎: 它在内存里合成一份配置, 给模型一套受限的内置工具 (`read_file`、`write_file`、`list_files`、`search_files`), 限制在输出文件所在目录. 然后模型写出主配置, 以及所需的工具源码、技能、权限文件.

```bash
# 默认: 写到 ./botward.json (同时生成 ./tools/、./skills/、./permissions/)
botward init "an agent that reads files and echoes back the first line"

# 自定义输出路径: 文件所在目录即为项目根目录
botward init -o ./agents/notify/botward.json "a Slack notifier agent"
```

init 完成后, 运行生成的配置:

```bash
botward execute -c ./agents/notify/botward.json "send today's summary to #bot-updates"
```

## 编程 API

`botward` 同时也是一个可以被 import 的库. CLI 只是同一套引擎的薄包装, 你可以直接在 Node 里驱动它:

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
console.log(result.finalText);  // 字符串, 不写 stdout
```

### `new Botward(options)`

| 字段 | 类型 | 说明 |
|---|---|---|
| `providers` | `ProviderConfig[]` | 必填, 至少一个. 每种 `type` 只能出现一次; 想区分同一 provider 的不同模型, 用 `model`. |
| `cwd` | `string?` | 默认 `process.cwd()`. 用于解析相对的 `config` / `output` 路径. |
| `llmFactory` | `(config, opts) => LLMClient?` | 测试钩子. 默认用内置 factory. |

`ProviderConfig`:

```ts
{ type: 'anthropic' | 'openai', apiKey?: string, baseUrl?: string, model?: string }
```

### `botward.execute(task, { config }) -> Promise<AgentRunResult>`

加载 `config` (一个 `botward.json` 的路径), 跑与 `botward execute` 相同的循环. 返回 `{ finalText, iterations, stopReason }`. 不写 stdout. 配置错误或循环失败时抛 `BotwardError`.

### `botward.init(requirements, { output, provider?, model? }) -> Promise<InitResult>`

与 `botward init` 用同一引擎. 自动创建 `output` 的目录. 返回 `{ result, outputPath, outputDir, provider, model }`. 模型一直没写出主配置时抛 `BotwardError`.

```js
const { outputPath, result } = await botward.init(
  'an agent that reads files and echoes the first line',
  { output: 'agents/notify/botward.json' },
);
```

### Provider 解析

`providers` 是一个有序数组. 解析规则:

1. 构造器拒绝空数组、未知的 `type`、以及重复的 `type`.
2. `execute` 查找 `type === config.provider` 的那条. 它的 `apiKey` / `baseUrl` / `model` 传给 LLM factory; 字段缺失时 factory 仍会回退到环境变量和 SDK 默认值.
3. `init` 在没显式指定 `provider` 时, 取 `apiKey` 已设置的第一个. 指定了 `provider` 时, 那条必须存在 (否则抛 `BotwardError`).

### 错误

库内部抛出的所有错误都是 `BotwardError`, 调用方可以这样过滤:

```js
import Botward, { BotwardError } from 'botward';
try { await botward.execute(task, { config }); }
catch (err) {
  if (err instanceof BotwardError) { /* 预期的错误 */ }
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

## 开发

```bash
npm run dev         # 用 tsx 跑
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # 打包到 dist/cli.js
```