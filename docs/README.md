# Hive Nest design docs

**Product language:** English (UI, API errors, and these docs).

The active product is a **local desktop/browser client + `sessiond` sidecar + SSH**. The old **Queen / Worker** dial-out stack is legacy only ([legacy-queen-worker.md](./legacy-queen-worker.md)).

## Mainline

| Doc | Topic |
|-----|--------|
| [00-overview.md](./00-overview.md) | Goals, non-goals, MVP scope |
| [10-iterm-client.md](./10-iterm-client.md) | Client UX, Agent rules, implementation status |
| [01-architecture.md](./01-architecture.md) | Components, trust model, data model |
| [03-capability-roadmap.md](./03-capability-roadmap.md) | Phased roadmap |
| [04-tech-stack.md](./04-tech-stack.md) | Stack and repo layout |
| [05-security-threat-model.md](./05-security-threat-model.md) | Session + Agent threats |
| [11-desktop-packaging.md](./11-desktop-packaging.md) | Tauri build, sidecars, signing notes |

## Code READMEs

- [../README.md](../README.md) — quick start
- [../client/README.md](../client/README.md) — UI dev
- [../sessiond/README.md](../sessiond/README.md) — sidecar API
