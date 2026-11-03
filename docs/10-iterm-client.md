# Client and session-scoped Agent

**Product:** local SSH terminal + Agent bound to the **current session** (one host per tab).

## User stories (MVP)

1. Add a host (`user@host:port`, key, password, or agent) and connect.
2. Use an interactive PTY (xterm) in the main pane.
3. Use the Agent pane for the **same session** — questions, suggestions, approved exec.
4. Open multiple tabs; each tab is one host; Agent never runs on a different host than the active tab.

## Core concepts

| Term | Meaning |
|------|---------|
| Host profile | Saved connection settings (incl. jump / ProxyJump chain) |
| Session | One SSH context: PTY + exec/tools |
| Proposal | Agent-suggested command with reason, risk, approve/deny |
| Audit | Local log of user and Agent actions |

## Agent rules

1. **Never hide commands** — proposed and executed argv are visible.
2. **Medium/high risk requires approve** (writes, deletes, package install, etc.).
3. **Scope = current session** only.
4. **No silent key upload** or cloud storage of SSH secrets.

Tools are implemented via **sessiond** (`POST …/exec`, `POST …/tools`) and optional **MCP** (desktop). See [sessiond/README.md](../sessiond/README.md).

## Client stack

| Layer | Location |
|-------|----------|
| UI | `client/` — React, Vite, xterm.js |
| Desktop | `client/src-tauri/` — Tauri 2, sessiond sidecar |
| Sidecar | `sessiond/` — Go, loopback `:7788` |

Dev: browser at `http://127.0.0.1:5173/` with sessiond running. Prod: `make tauri-build`.

## UI features (shipped)

- Host CRUD, connect/disconnect, session tabs
- Terminal themes + app chrome themes (Settings)
- Agent: LLM providers, multi-turn tool loop, native Anthropic tools path, skills, MCP
- Connect password modal; host key TOFU; jump / ProxyJump
- English-primary i18n (+ es, fr, de, pt, uk, ja, ko, zh-CN, zh-TW)
- Agent chat history per host (localStorage)

## Not in MVP / open

- Signed installers and auto-update (see [11-desktop-packaging.md](./11-desktop-packaging.md))
- Full enterprise RBAC / cloud profile sync
- Mandatory remote Worker

## Tests

```bash
cd client && npm test && npm run build
cd sessiond && go test ./...
```

Root quick start: [README.md](../README.md).
