# Tech stack

## Principles

- Core loop works offline except user-chosen LLM APIs.
- Reuse **Go** (SSH) and **React** (UI).
- No mandatory agent on remote hosts for MVP.
- **sessiond** on loopback + token; approve hooks for risky exec.

## MVP stack

| Layer | Choice |
|-------|--------|
| Desktop shell | **Tauri 2** (Windows, Linux, macOS) |
| UI | **React**, Vite, **xterm.js** |
| SSH / PTY / exec | **Go `sessiond`** (`golang.org/x/crypto/ssh`) |
| Local API | HTTP + WebSocket on `127.0.0.1:7788` |
| Persistence | JSON files under OS app-data dirs (hosts, audit, known_hosts) |
| Agent | Client-side loop; LLM via configured providers; tools → sessiond |
| i18n | English primary; additional locales in `client/src/i18n/` |

**Why Go sessiond (not browser SSH)?** Safe use of ssh-agent, known_hosts, and consistent behavior across OSes.

**Why not Queen Docker for MVP?** Product path is session-first client, not a public fleet control plane.

## Repository layout

```text
client/       Active UI (Vite + React; Tauri in src-tauri/)
sessiond/     Loopback SSH sidecar (Go)
docs/         Design (this folder)
web/          Legacy Queen SPA — see web/LEGACY.md
queen/ worker/ protocol/ deploy/ install/   Legacy dial-out stack
api/          OpenAPI sketches
```

## Process model (desktop)

```text
Hive Nest.app (Tauri)
  ├─ WebView: client UI
  └─ sidecar: sessiond → SSH → target host
```

## Observability

- JSONL audit in sessiond data dir
- sessiond logs (no secrets)
- Client toasts for user-visible errors

Packaging: [11-desktop-packaging.md](./11-desktop-packaging.md).
