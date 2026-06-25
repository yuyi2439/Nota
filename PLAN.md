# PLAN.md

> Nota 开发计划。
> **当前目标**：专注实现单一 persona 的可用体验，不再追求完整 agent 框架。
> 原框架性计划（多 persona、插件、权限分级、workspace 控制）整体移入 P1，暂不实现。

## P0 — 本次实现（单一 persona 可用）

### M0 项目骨架
- [x] 初始化 package.json（ESM、type: module、bin: nota）
- [x] 配置 tsconfig.json（ES2022，无 DOM）
- [x] pnpm 安装依赖：openai、better-sqlite3、ink、react、commander、@iarna/toml、ws
- [x] pnpm 安装开发依赖：tsx、tsup、vitest、typescript、@types/*
- [x] 建立源码目录结构
- [x] 运行时目录约定：`~/.nota/`
- [x] 脚本 dev/build/test/typecheck
- [x] `src/version.ts`、`src/core/paths.ts`、`src/core/constants.ts`

### M1 Core daemon 服务端
- [x] HTTP server 监听 127.0.0.1:2349（仅回环）
- [x] 自研轻量 REST 路由 `src/core/server/router.ts`
- [x] WebSocket 服务端（`?session=<id>` 订阅）
- [x] SSE 端点支持（留第三方拓展）
- [x] `src/core/server/pubsub.ts`：SubscriptionManager（单订阅约束）+ SSEManager
- [x] 内置路由 `/health`、`/admin/shutdown`
- [x] CLI `nota daemon start|stop|status|run`

### M2 Session Manager
- [x] per-session sqlite 文件管理 `~/.nota/sessions/<id>.sqlite`
- [x] schema：`meta`、`messages`、`schedules` 表
- [x] 创建/加载/列出/归档/恢复
- [x] 30 天自动归档 + `sweepExpired()` 启动扫描
- [x] archive 后不活动、计划不执行、不可直连
- [x] classification 字段留口子（现仅 archive 子目录）

### M3 Persona（单一 persona）
- [x] PersonaManager：统一配置 `~/.nota/personas/config.sqlite`
- [x] Persona 工作区 `~/.nota/personas/<name>/`（name 作目录名，可改名）
- [x] prompt 存工作区 `.md` 文件，系统自动加载拼接为 system prompt
- [x] main session 配置（setMainSession）
- [x] 交互式初始化：首次运行无 persona 时提示用户输入名称并创建
- [x] 移除默认 "Agent" 自动创建
- [x] CLI/TUI 不暴露 persona 选择参数，始终用唯一 persona

### M4 Callback / 订阅模型
- [x] AgentRunner 流式回调接入 pubsub（onDelta/onToolResult/onMessage → subscriptions.push）
- [x] WS 订阅端收到流式 delta 与最终消息
- [x] HTTP 路由 POST /session/:id/messages 触发 agent
- [x] 同一 session 同一时刻只能被一个 participant 订阅
- [x] 引用（非订阅者）：GET /session/:id 只读历史
- [x] callback 不持久化，重启由 participant 自行重挂
- [ ] session.set_callback(fn) 进程内绑定接口（插件用，P1 再做）
### M6 推理循环（LLM + tool calling）
- [x] 加载 session 历史 + persona system prompt（自动加载工作区 .md 全部注入）
- [x] LLM 抽象 `ILlmClient`；内置 `LlmClient`（OpenAI API 格式）
- [x] tool calling 循环（最多 16 轮）
- [x] 流式 stream（delta + tool_calls 累积 + done）
- [x] tool 调用/结果存入 messages

### M7 Tool Registry
- [x] `ToolRegistryImpl` 统一管理
- [x] tool 带 ToolContext（personaName, sessionId）注入
- [x] 同步 tool 支持；异步 tool（回灌触发下一轮）→ P1
- [ ] 按 plugin.json `tools` 字段主动加载 → P1（M9）

### M8 内置工具
- [x] file_read / file_write（限 persona 工作区，越界 access denied）
- [x] schedule（存 `schedules` 表；archive 不执行；调度器 → P1）
- [x] tool 修改框架数据全局拦截 → P1
- [x] `registerBuiltinTools(registry, personas, sessions)`

### M10 TUI 客户端（ink）
- [x] 会话列表 / 新建 / 切换（基础版；`/sessions`、`/switch` 待完善）
- [x] 消息流（WS 流式显示 delta + assistant_message）
- [x] 工具输出展示（tool_result 事件）
- [ ] `/` 指令完整实现（当前仅 /quit /help /clear；/new /sessions /switch /archive /archives /restore /tools 待补）
- [x] 启动可传 sessionid（`nota tui --session <id>`）
- [x] WS 订阅连接
- [x] 始终用唯一 persona（不暴露 persona 选择）

### M11 CLI 客户端（commander）
- [x] `nota daemon start|stop|status|run`
- [x] `nota session list|show|archive|restore`
- [x] `nota chat [--session <id>] [--no-stream]`（无 --persona，用唯一 persona）
- [x] `nota tui [--session <id>]`
- [x] 交互式初始化（首次运行建 persona）
- [ ] `nota plugins *` → P1（M9）

---

## P1 — 近未来（框架性功能，暂不实现）

### 多 persona / 框架化
- [ ] 多 persona 管理（创建/切换/删除）
- [ ] persona 可用 tool 子集由 master 控制增删
- [ ] Persona WorkSpaces 由 master 控制扩展
- [ ] persona 独立思考 / 主动行动（含 schedule 触发的自我推理 + schedule 调度器）
- [ ] 异步 tool 回灌触发下一轮 agent loop
- [ ] 两个 persona 聊天的申请 / 拒绝 / 停止

### M9 Plugin Loader
- [ ] 扫描 `~/.nota/plugins/*/plugin.json`
- [ ] 注入 NotaContext（带 level）
- [ ] 生命周期 register → start → stop
- [ ] daemon 启动默认全量热加载一次
- [ ] 运行中热重载 `nota plugins reload <plugin>`
- [ ] 按 plugin.json `tools` 字段主动查找加载
- [ ] `nota plugins list|tools|reload` CLI 子命令

### M5 权限系统
- [ ] 三级：master(仅CLI) / admin(默认TUI) / normal(插件默认)
- [ ] `NotaContext` 带 `level` 字段
- [ ] `ctx.admin` 管理接口
- [ ] session 可见性校验
- [ ] archive/restore 权限校验
- [ ] tool 广播过滤（admin+ 可见 tool 细节，普通 participant 只见 assistant 文本）

### 其它 P1
- [ ] 系统服务配置（daemon 开机自启）
- [ ] tool 修改框架数据全局拦截
- [ ] 外装 tool 需 master 批准
- [ ] master 任命 admin（持久化到 `config.toml`）
- [ ] master 设置 session 引用关系（存 session meta 表）
- [ ] session.set_callback(fn) 进程内绑定接口
- [ ] lint 脚本配置

---

## P2 — 远未来

- [ ] QQ 插件：独立 sqlite 存原始消息、不创建 session、群消息静默、私信时自检索
- [ ] session 其它分类机制（按 channel 等）
- [ ] LLM provider 插件接口
- [ ] loopback 鉴权 token
- [ ] 第三方客户端接入拓展（基于 REST + SSE）

---

## 暂不一定实现（P-1）

- **user 级 client**：低于 admin，只能参与 session，不能查看 tool 调用。留待确认实际需求后再决定。
