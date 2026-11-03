# Overview

Hive Nest is a **local SSH client** (iTerm-style) with a **session-scoped Agent**: one host per tab, real PTY terminal, and command proposals that stay visible and require approval for medium/high risk.

## Goals (MVP)

| Goal | Description |
|------|-------------|
| Local-first client | Windows, Linux, macOS (Tauri) or browser + loopback `sessiond` for dev |
| Session = host | Agent and tools are bound to the active session; no cross-host execution |
| Visible commands | Full argv shown; writes and high-risk ops need explicit approve |
| Keys stay local | SSH keys / agent on the machine; no mandatory cloud control plane |
| Remote = sshd only | No Hive Nest Worker required on targets for MVP |

## Non-goals (MVP)

- Public Queen + fleet of outbound Workers as the primary path
- Silent destructive Agent actions or hidden argv
- Mandatory Worker install before opening a terminal
- Full CMDB / EDR / enterprise session recording replacement

## Architecture (one line)

```text
[Client UI + Agent] ↔ [sessiond @ 127.0.0.1] --SSH--> [remote sshd]
```

## Roadmap (summary)

1. **Now:** `client/` + `sessiond/` — hosts, PTY, exec, tools, proposals, LLM Agent, Tauri shell.
2. **Next:** polish packaging, known_hosts UI, stricter Agent loops.
3. **Later (optional):** jump/SFTP depth, lightweight host agent, team/cloud sync (trimmed Queen ideas).

Details: [10-iterm-client.md](./10-iterm-client.md), [03-capability-roadmap.md](./03-capability-roadmap.md).

## Legacy

Queen / Worker / Docker demo: [legacy-queen-worker.md](./legacy-queen-worker.md). Not required for MVP acceptance.
