# Botward

Botward 是个极为简单的 AI agent, 主要定位于处理一些不需要人类监督的特定单独任务, 例如接入某些外部服务的 webhook. 

它并非设计为一个通用智能体, 甚至不是一个能保留长期复杂记忆的智能体. 它记忆系统仅供其完成一个单独任务. 

它使用简单, 可以很方便地在本地同时唤起多个 agent 实例来并行执行任务.

## 基本用法

```bash

# 直接启动一个任务, 新任务直接启动一个新的 agent, 任务执行完就退出, 
# agent 不保留任何状态.
botward execute 'Add new feature to the CMS project!. ....'

# 通过配置文件开始一个任务.  你可以将系统Prompt、skills、tools 等配置于其中.
botward execute -c botward.json 'Add new feature to the CMS project!. ....'

# 初始化一个完整的 botward 项目 (主配置 + 工具文件 + 技能), 不用手写, 输入需求 ai 自动生成
# -o 指向主配置文件的路径, 其所在目录就是项目根目录
botward init -o botward.json '一个能读项目源文件并回显第一行的 agent'

# 开始一个聊天会话, ai 会根据于你的对话来一步步完成任务 (计划中, 暂未实现)
botward chat -c botward.json

# 开一个服务, 用户可通过 http 请求来开启新任务, 每个任务是个单独 agent 实例.
# --workers 设置可并发执行的任务数, 默认为1, 暂时无法处理的任务会排队. (计划中, 暂未实现)
botward serve -c botward.json -p 8080 --workers 1

```

## 配置文件

```json
{
  "name": "Botward",
  "version": "0.1.0",
  "description": "A chatbot for developers",
  "systemPrompt": "You are a ....",
  "skills": [{
    "name": "webDev",
    "description": "A skill for web development",
    // 可选, 用于描述技能的详细内容
    "content": "This is skill file .....",  
    // 可选, 描述技能文件可以是多个文件, 放置于单独目录, 与其他通用 agent 的 skill 兼容.
    "dir": "path/to/skill/dir"  
  }],
  "tools": [{
    "name": "read-file",
    // 权限表达式, 具体格式依据不同的 tool 来定义. 可选
    "permission": "workspace/*/*.js",  // 或 ["workspace/*/*.js", "tests/**"]
    // 也可写数组, 每个元素是一条表达式, 跟 permissionFile 等效但内联.
    // 写入权限表达式的文件路径, 可以是任何格式的文件, 具体如何解析依据不同的 tool 来决定. 可选
    "permissionFile": "read_file_permission.json",
    "description": "A tool for read file",
    "code": "// cjs code ... ",
    "file": ""
  }],

}
```

## API 使用

`botward` 同时也是一个可以被 import 的库. CLI 只是它的薄包装, 你可以在 Node 里直接驱动同一个引擎.

```javascript
import Botward from 'botward';

const botward = new Botward({
  providers: [{
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: process.env.ANTHROPIC_API_KEY,
  }]
});

// 跟 botward init 一样, 自动 mkdir, 多文件项目, 不写 stdout
const { outputPath, result } = await botward.init(
  '一个能读项目源文件并回显第一行的 agent',
  { output: 'botward.json' }
);

// 跟 botward execute 一样, 复用同一个 agent loop
const { finalText, iterations } = await botward.execute(
  'Add new feature to the CMS project!. ....',
  { config: 'botward.json' }
);
```

### `new Botward(options)`

| 字段 | 类型 | 说明 |
|---|---|---|
| `providers` | `ProviderConfig[]` | 必填, 至少一个. 每个 type (`anthropic` / `openai`) 只允许出现一次; 想换模型请用 `model` 字段, 而不是新增条目. |
| `cwd` | `string?` | 默认 `process.cwd()`. 用来解析相对路径的 `config` / `output`. |
| `llmFactory` | `(config, opts) => LLMClient?` | 测试用钩子. 留空走内置工厂. |

`ProviderConfig`:

```ts
{ type: 'anthropic' | 'openai', apiKey?: string, baseUrl?: string, model?: string }
```

### `botward.execute(task, { config }) -> Promise<AgentRunResult>`

读取 `config` 指向的 `botward.json`, 跑和 `botward execute` 完全相同的 agent loop.
返回 `{ finalText, iterations, stopReason }`. 不向 stdout 写任何东西.
出错抛 `BotwardError`.

### `botward.init(requirements, { output, provider?, model? }) -> Promise<InitResult>`

和 `botward init` 同引擎. 自动创建 `output` 的目录. 返回
`{ result, outputPath, outputDir, provider, model }`. 模型没写出主配置时抛 `BotwardError`.

### Provider 解析规则

`providers` 是一个有序数组, 解析顺序:

1. 构造时拒绝空数组 / 未知 `type` / 重复 `type`.
2. `execute` 找 `type === config.provider` 的条目, 把它当作 `apiKey` / `baseUrl` / `model` 的来源; 找不到就回落到环境变量和 SDK 默认值(行为与 CLI 一致).
3. `init` 不传 `provider` 时, 选**第一个有非空 apiKey** 的条目; 显式 `provider` 必须能匹配一个条目, 否则抛错.

### 错误处理

库抛出的所有错误都是 `BotwardError`, 可以用 `instanceof` 过滤:

```js
import Botward, { BotwardError } from 'botward';
try {
  await botward.execute(task, { config });
} catch (err) {
  if (err instanceof BotwardError) { /* 可预期 */ }
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