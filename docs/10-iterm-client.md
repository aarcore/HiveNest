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
- Fleet Agent: a second, session-free Agent that works across many servers, with inline (non-persisted) connections for cluster tasks

## Fleet Agent

The session Agent is deliberately bound to one host. Fleet is the counterpart: a panel that owns a *roster* of servers and can touch any of them in one conversation, which is what cluster setup needs.

- **Roster, not sessions.** Servers are registered with name, address, user, auth mode, optional group and role. Groups drive batch work (`target: "prod-k8s"`).
- **Connections are inline.** Fleet calls `POST /v1/sessions/inline`, which dials from details in the request and returns a session without writing a host profile. Touching twelve machines leaves twelve sessions closed and zero host entries.
- **One command per connect.** Each step opens a session, runs one command, closes it. Slower than holding connections open, but it keeps no idle SSH sessions to machines the user touched once, and a credential change is picked up on the next step.
- **Passwords live in the chat.** They are parsed out of the model's reply before it reaches the transcript, passed to `sessiond` at connect time, and optionally remembered in the OS vault. They are never in the prompt history, the roster, or `hosts.json`.
- **The same risk gate applies.** `sessiond` still classifies every command. A medium/high command in Fleet surfaces as an approval card; the session is throwaway, so nothing is executed until the user agrees.
- **Changed host keys stop the run.** First contact is trusted (TOFU, same as a normal connect); a *changed* key aborts with an error naming the previous fingerprint rather than silently accepting it.

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
