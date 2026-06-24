# AGENT.md

> This document is for contributors (including AI assistants) working on Nota.
> Follow these conventions to keep the implementation consistent.

## Commands

- **Install deps**: `npm install`
- **Dev run**: `npm run dev` (tsx)
- **Build**: `npm run build` (tsup)
- **Test**: `npm test` (vitest)
- **Lint / typecheck**: `npm run lint` / `npm run typecheck`

> If any script is missing or needs adjustment, update this section too.

## Data & config location

All runtime data and config live under `~/.nota/`, regardless of the current
working directory when Nota runs:

```
~/.nota/
├── config.toml            # global config (master-appointed admins, etc.)
├── sessions/              # <id>.sqlite (flat by default)
│   └── archive/           # archived sessions
├── personas/
│   ├── config.sqlite      # unified persona config
│   └── Agent/             # default persona workspace (*.md files)
└── plugins/               # user plugins (each with plugin.json)
```

The source tree never holds runtime data.

## Architectural principles

1. **Strict Core / plugin separation**
   - Core handles only: session, persona, agent loop, tool registry, plugin
     loader, server.
   - Anything internal to a plugin (how it stores its own messages, group/private
     handling, whether it's an IM adapter or a webUI) is **completely outside
     Core's concern**.
   - Plugin storage is independent; Core exposes **no memory-store interface**
     (e.g. a future QQ plugin keeps its own sqlite and searches it itself).

2. **Daemon architecture**: Core runs as a system service; CLI / TUI /
   third-party clients connect via REST + WS + SSE. Port is hardcoded
   `127.0.0.1:2349` (loopback only, never 0.0.0.0).

3. **Persona is the centerpiece**: what sets Nota apart from other agent
   frameworks is that a persona can self-iterate and adapt. Every design
   decision revolves around persona independence.

4. **Archive, never delete**: Core never deletes a session file. Archiving only
   moves it to `~/.nota/sessions/archive/`.

## Key conventions

### Session
- One sqlite file per session: `~/.nota/sessions/<id>.sqlite` (flat when
  unclassified)
- Tables: `meta`, `messages`, `schedules`
- `meta` columns: `id, creator, participants, created_at, archive_at,
  archived_at, classification?`
- **Callback is not persisted**: after a restart each participant re-attaches its
  own callback.
- Any number of participants; a session is "active" only when it has at least
  one participant.
- 30-day auto-archive; startup scans for expired sessions; archive/restore is
  admin+ or creator only.

### Persona
- Unified config at `~/.nota/personas/config.sqlite`
- Workspace at `~/.nota/personas/<id>/` (markdown files the persona reads/writes
  itself)
- `main_session` is recorded in persona config but is just a normal session to
  the Session Manager
- A persona may only read/write files inside its own workspace; everything else
  is forbidden
- Default persona: `Agent`

### Tool calls & broadcast
- Tool calls and results are stored as messages in the session (roles
  `tool_call` / `tool_result`)
- **Broadcast filtering**: admin+ sees tool-call details; ordinary participants
  (including the other persona in a persona-to-persona chat) see only the
  assistant's text messages — tool internals never leak
- Tools may be synchronous or asynchronous:
  - Sync tool: the agent loop blocks for the result, then continues the LLM
  - Async tool: returns "accepted" immediately; the result is later fed back as
    a `tool_result` message that triggers the next loop turn (`schedule` is the
    canonical async tool)

### Plugin
- Declared via `plugins/*/plugin.json` with fields:
  `name, version, description, entry, tools[], config?`
- Core **actively** loads the tools listed in `tools` (finds each declared tool
  by name in the entry, then calls a约定的 interface to obtain its description)
- A plugin may implement multiple functions at once; plugins are not categorized
- Injected context object name: `NotaContext`, carrying a `level` field
  (`master | admin | normal`) — not a boolean flag
- `ctx.admin` exposes management operations; calling it without permission
  returns an error
- Lifecycle: `register → start → stop`
- Daemon startup performs one full hot-load sweep; runtime hot-reload via
  `nota plugins reload <plugin>`

### Permissions
- **master**: CLI only; may set session reference relationships, appoint admins,
  approve third-party tools
- **admin**: TUI by default; may directly reference any session; cannot manage
  plugins or set reference relationships
- **normal**: plugin default; fully manages sessions it created (archive only,
  never delete)
- **user** level: **may or may not ever ship** (see end of PLAN.md)

### Clients / CLI / TUI
- **CLI** (master): pure subcommands, one-shot request/response that doesn't hold
  the terminal; SSE streaming by default, `--no-stream` for scripting
- **TUI** (admin): ink-based; `/` commands; WS subscription; streaming; accepts
  a session id at startup; **must not be aware of plugins** (no `/plugins`,
  no `/reload`)
- Daemon runs as a system service; `nota daemon status/stop` does not rely on a
  PID file

## Code style

- TypeScript ESM
- **No comments** unless the user explicitly asks
- Follow existing naming and directory conventions
- Never introduce dependencies not present in package.json

## Before implementing P1 / P2

Read the corresponding section of PLAN.md first.
