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

# 开始一个聊天会话, ai 会根据于你的对话来一步步完成任务
botward chat -c botward.json

# 开一个服务, 用户可通过 http 请求来开启新任务, 每个任务是个单独 agent 实例.
# --workers 设置可并发执行的任务数, 默认为1, 暂时无法处理的任务会排队.
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
    "permission": "workspace/*/*.js",
    // 写入权限表达式的文件路径, 可以是任何格式的文件, 具体如何解析依据不同的 tool 来决定. 可选
    "permissionFile": "read_file_permission.json",
    "description": "A tool for read file",
    "code": "// cjs code ... ",
    "file": ""
  }],

}
```

