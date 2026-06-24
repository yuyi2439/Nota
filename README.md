# Nota

> 一个以 **Persona（角色）** 为核心的 AI Agent 框架。

Nota 的核心设计理念是：**Persona 是相对独立的存在，能够自我迭代、适应用户习惯**。
框架本身只提供 session 管理、推理循环、工具调用与插件机制，把具体能力交给插件，把"思考"交给 persona。

## 特性

- **Persona 驱动**：每个 persona 拥有独立的设定、记忆、工作区与 main session；可自我迭代。
- **Session 模型**：一个 session 可有任意数量 participant（persona 或 client），所有 participant 只与 session 交互，共享会话历史。
- **常驻 Daemon 架构**：Core 作为后台服务运行，CLI / TUI / 第三方客户端通过 REST + WebSocket + SSE 连接。
- **三级权限**：master（仅 CLI）> admin（默认 TUI）> normal（插件默认）；插件通过 `ctx.admin` 调用管理接口。
- **插件化**：一个插件可同时实现多种功能（channel / tool / 其它），由 `plugin.json` 声明，Core 主动加载声明中的 tool。
- **内置工具**：文件读写（限 persona 工作区）、`schedule`（设定未来在 session 内推送消息的计划）。
- **归档而非删除**：框架永不删除 session 文件，过期或手动归档仅转移位置；归档后 session 不活动、计划不执行。

## 技术栈

- **语言**：TypeScript + Node.js (ESM)
- **TUI**：ink + React
- **CLI**：commander
- **存储**：better-sqlite3（每 session 一个 sqlite 文件）
- **LLM**：OpenAI API 格式（`openai` SDK，可对接任何兼容端点）
- **通信**：REST HTTP + WebSocket + SSE（仅监听 `127.0.0.1:2349`）
- **开发**：tsx / 构建：tsup / 测试：vitest

## 快速开始

```bash
# 安装依赖
npm install

# 构建插件
npm run build

# 启动 core daemon（后台）
nota daemon start --background

# 查看状态
nota daemon status

# CLI 一来一回聊天（默认 SSE 流式）
nota chat --persona Agent
nota chat --persona Agent --no-stream        # 非流式，供脚本调用
nota chat --session <id> --persona Agent     # 续接指定 session

# 启动 TUI 主界面
nota tui
nota tui --session <id>                      # 续接指定 session

# 列出 / 归档 / 恢复 session
nota session list
nota session archive <id>
nota session restore <id>

# 插件管理
nota plugins list
nota plugins tools
nota plugins reload <plugin>
```

## 架构

```
┌──────────────────────────────────────────┐
│  Core daemon (127.0.0.1:2349)             │
│  REST ── 请求/响应                        │
│  WebSocket ── session 订阅与流式推送      │
│  SSE ── CLI 流式 / 第三方拓展             │
│  ┌────────────────────────────────────┐   │
│  │ Session Manager  (per-session .db) │   │
│  │ Persona Manager  (personas/config) │   │
│  │ 推理循环 (LLM + tool calling)      │   │
│  │ Tool Registry                     │   │
│  │ Plugin Loader                     │   │
│  └────────────────────────────────────┘   │
│  插件在 core 进程内运行（如未来的 QQ 适配）│
└──────┬────────────────────────┬──────────┘
       │ REST + SSE             │ REST + WS
  ┌────┴────┐              ┌────┴────┐
  │ CLI     │              │ TUI     │
  │ master  │              │ admin   │
  └─────────┘              └─────────┘
```

## 数据与配置位置

不管 Nota 在文件系统何处运行，所有运行时数据与配置统一放在用户主目录下的 `~/.nota/`：

```
~/.nota/
├── config.toml            # 全局配置（master 任命 admin 等）
├── sessions/              # <id>.sqlite（不分类则平铺）
│   └── archive/           # 归档子目录
├── personas/
│   ├── config.sqlite      # 统一 persona 配置
│   └── Agent/             # 默认 persona 工作区（.md 文件）
└── plugins/               # 用户插件目录（各含 plugin.json）
```

源码目录结构（不含运行时数据）：

```
Nota/
├── src/
│   ├── core/
│   │   ├── session/      # Session Manager + sqlite + archive
│   │   ├── persona/       # Persona 配置与工作区管理
│   │   ├── agent/         # 推理循环 (LLM + tool calling)
│   │   ├── llm/openai/    # 内置 OpenAI 格式
│   │   ├── tool/          # Tool Registry + 内置 tool
│   │   ├── plugin/        # Plugin Loader + NotaContext
│   │   └── server/        # REST + WS + SSE 服务端
│   ├── tui/               # ink 主界面
│   ├── cli/               # commander 入口
│   └── index.ts
├── package.json
└── tsconfig.json
```

## 权限模型

| 级别 | 说明 | 谁是 |
|---|---|---|
| **master** | 唯一；可设置 session 引用关系、任命 admin、批准外装 tool | 仅 CLI |
| **admin** | 可有多个；可**直接引用**任意 session；不能管理插件、不能设置引用关系 | 默认 TUI；master 可任命插件 |
| **normal** | 插件默认；能完全管理自家 session（只能归档不能删除） | 普通插件 |

插件通过 `ctx.admin` 调用管理接口，若无权限则返回错误。

## Session 参与者（Participant）

一个 session 可有 **任意数量** participant（1 个也行，如 persona 独立思考）。有 participant 才算激活的 session。所有 participant 只与 session 交互，都能读取当前 session 历史。

- participant 类型：`persona` 或 `client`
- session meta 记录 `participants` 列表
- 同一 session 同一时刻只能被一个 participant **订阅**（接收 callback 推送）；非创建者只能**引用**（读历史，不推送）

## Persona

Persona 是本项目的重点，区别于其它 agent 框架。

- 默认提供 `Agent`（无特殊功能），master 可创建新 persona
- 每个 persona 拥有：
  - 设定（system prompt）
  - 记忆与个人文件（`personas/<id>/*.md`，persona 自己读写维护）
  - main session（持久主会话，在 `personas/config.sqlite` 中指定）
  - 可独立思考、可创建 session、可自我迭代
- persona 只能读写自己工作区内的文件，其余一律禁止
- 默认只能用部分内置 tool，由 master 控制增删（P1）

## 内置工具

- **file read/write**：作用域限 persona 自己的工作区；尝试修改框架数据时返回"操作禁止"（拦截在 P1 实现，配置文件可改）
- **schedule**：设定"何时在本 session 推送某条消息"，存入 session sqlite 的 `schedules` 表；归档的 session 不执行计划

## 参考文档

- [PLAN.md](./PLAN.md)
