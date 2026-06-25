# PLAN.md

> Nota 开发计划。P0 为本次实现，P1 为近未来，P2 为远未来。

## P0 — 本次实现（搭框架 + 核心功能）

### M0 项目骨架
- [x] 初始化 package.json（ESM、type: module）
- [x] 配置 tsconfig.json
- [x] 安装依赖：openai、better-sqlite3、ink、react、commander、@iarna/toml 等
- [x] 安装开发依赖：tsx、tsup、vitest、typescript、@types/*
- [x] 建立源码目录结构（src/core/*, src/tui, src/cli）
- [x] 运行时目录约定：`~/.nota/`（sessions/personas/plugins/config.toml），程序启动时自动创建
- [x] `pnpm dev` / `pnpm build` / `pnpm test` 脚本

### M1 Core daemon 服务端
- [x] HTTP server 监听 127.0.0.1:2349
- [x] REST 路由框架（用于session/persona/chat/plugins 管理）
- [x] WebSocket 服务端（session 订阅与流式推送）
- [x] SSE 端点（CLI 流式 / 第三方拓展）
- [x] 系统服务配置（daemon 后台运行）

### M2 Session Manager
- [ ] per-session sqlite 文件管理（创建路径 `~/.nota/sessions/<id>.sqlite`）
- [ ] schema：`meta`、`messages`、`schedules` 表
    - `meta`：id, creator, participants, created_at, archive_at, archived_at, classification?
    - `messages`：id, role(assistant|tool_call|tool_result|...), content, tool_calls, tool_call_id, type, created_at
    - `schedules`：id, trigger_at, content, status
- [ ] 创建 session：core 内部写 creator（插件 API 不暴露该参数）；participants 可选
- [ ] 加载 session：按 creator 校验（normal 只能 load 自家；admin+ 放行）
- [ ] 列出 session（按权限可见范围）
- [ ] 30 天自动归档 + 启动扫描
- [ ] archive/restore：移动到 `~/.nota/sessions/archive/`；仅 admin+ 或 creator 可操作
- [ ] archive 后 session 不活动、计划不执行、不可直连
- [ ] session 可选分类机制（机制留口子，现仅 archive）

### M3 Participant + Persona
- [ ] Participant 模型（persona | client，任意数量）
- [ ] Persona Manager：统一配置 `~/.nota/personas/config.sqlite`
- [ ] Persona 工作区 `~/.nota/personas/<id>/`（markdown 文件）
- [ ] 默认 persona `Agent`
- [ ] main session 配置（在 persona 配置中指定）
- [ ] persona 只能读写自己工作区内文件，其余禁止
- [ ] persona 可创建 session、可独立思考（被 session 消息触发或自我触发）

### M4 Callback / 订阅模型
- [ ] `session.set_callback(fn)`：可多次调用更换（一般设一次）
- [ ] 进程内插件：直接 JS 函数回调
- [ ] WS 订阅：core 提供 callback，经 WS 推送（流式同路径）
- [ ] 同一 session 同一时刻只能被一个 participant 订阅
- [ ] 引用（非 creator）：只读历史，不推送
- [ ] callback 不持久化，重启由 participant 自行重挂

### M5 权限系统
- [ ] 三级：master(仅CLI) / admin(默认TUI) / normal(插件默认)
- [ ] `NotaContext` 带 `level` 字段（非布尔标记）
- [ ] `ctx.admin` 管理接口，无权限返回错误
- [ ] session 可见性校验（normal 只见自家；admin+ 直引任意）
- [ ] archive/restore 权限校验

### M6 推理循环（LLM + tool calling）
- [ ] 加载 session 历史 + persona system prompt + memory（MVP 全部注入 persona 相关文件）
- [ ] 调 LLM（OpenAI API 格式，可对接兼容端点）
- [ ] tool calling 循环：LLM 请求 tool → 执行 tool → 结果回灌 → 再调 LLM → 直到产出最终文本
- [ ] 结果经 session callback 推送（支持流式）
- [ ] tool 调用/结果存入 messages；广播按权限过滤（admin+ 可见 tool 细节，普通 participant 只见 assistant 文本）

### M7 Tool Registry
- [ ] 统一管理，不区分来源
- [ ] 按 plugin.json `tools` 字段主动查找加载（按声明名到 entry 找对应 tool）
- [ ] 调用约定接口取 description 注册
- [ ] 同步/异步 tool 支持（异步 tool 回灌触发下一轮）

### M8 内置工具
- [ ] file read/write（作用域限 persona 自己的工作区）
- [ ] schedule（设定未来在 session 推送消息；存 `schedules` 表；archive 的 session 不执行）
- [ ] 尝试修改框架数据 → 返回"操作禁止"（拦截逻辑 P1 实现，配置文件可改）

### M9 Plugin Loader
- [ ] 扫描 `plugins/*/plugin.json`
- [ ] 注入 NotaContext（带 level）
- [ ] 生命周期 register → start → stop
- [ ] daemon 启动默认全量热加载一次
- [ ] 运行中热重载 `nota plugins reload <plugin>`

### M10 TUI 客户端（ink）
- [ ] 会话列表 / 新建 / 切换
- [ ] 消息流（流式显示）
- [ ] 工具输出展示
- [ ] `/` 指令：`/new` `/sessions` `/switch <id>` `/archive <id>` `/archives` `/restore <id>` `/tools` `/help` `/quit` `/clear`
- [ ] 启动可传 sessionid
- [ ] WS 订阅连接
- [ ] admin 权限（直引任意 session；不暴露插件存在）

### M11 CLI 客户端（commander）
- [ ] `nota daemon start [--foreground|--background]`
- [ ] `nota daemon stop`
- [ ] `nota daemon status`（不靠 PID）
- [ ] `nota session list`
- [ ] `nota session show <id>`（引用：读历史）
- [ ] `nota session archive <id>`
- [ ] `nota session restore <id>`
- [ ] `nota chat [--session <id>] [--persona <id>] [--no-stream]`（SSE 默认流式）
- [ ] `nota plugins list`
- [ ] `nota plugins tools`
- [ ] `nota plugins reload <plugin>`

---

## P1 — 近未来

- [ ] persona 可用 tool 子集由 master 控制增删
- [ ] Persona WorkSpaces 由 master 控制扩展
- [ ] tool 修改框架数据拦截（返回"操作禁止"，配置文件可改）
- [ ] 外装 tool 需 master 批准才能使用
- [ ] master 任命 admin（CLI 子命令 `nota grant admin <plugin>`；持久化到 `config.toml`）
- [ ] master 设置 session 引用关系（存 session 自身 meta 表）
- [ ] persona 独立思考 / 主动行动（含 schedule 触发的自我推理）
- [ ] 两个 persona 聊天的申请 / 拒绝 / 停止（当前只能 master 牵线）

---

## P2 — 远未来

- [ ] QQ 插件：独立 sqlite 存原始消息、不创建 session、群消息静默、私信时自检索；通过 NotaContext 与 core 交互
- [ ] session 其它分类机制（按 channel 等）
- [ ] LLM provider 插件接口（抽象 ChatProvider，内置 OpenAI 实现之一）
- [ ] loopback 鉴权 token（本地启动生成，客户端从固定文件读取附请求头）
- [ ] 第三方客户端接入拓展（基于 REST + SSE）

---

## 暂不一定实现（P-1）

以下功能不在当前计划中，未来也未必添加：

- **user 级 client**：低于 admin，只能参与 session，不能查看 tool 调用。当前三级（master/admin/normal）已覆盖主要场景，user 级优先级低，留待确认实际需求后再决定。
