# Legacy: Queen / Worker control plane

**Not the Hive Nest MVP path.** The active product is **`client/` + `sessiond/`** (SSH from the user’s machine).

## What it was

- **Queen:** HTTP/Web control plane + embedded **`web/`** SPA (`make queen-with-ui`).
- **Worker:** Outbound WebSocket dial to Queen; typed jobs and optional host guard.
- **protocol/:** Queen ↔ Worker message shapes.
- **deploy/:** Docker Compose demo (Queen + sample Worker).

Useful for historical reference or future “fleet sync” ideas — not required to use the terminal client.

## Where to look

| Path | Contents |
|------|----------|
| [web/LEGACY.md](../web/LEGACY.md) | Queen UI quarantine notice |
| [web/README.md](../web/README.md) | Build Queen SPA only |
| `queen/`, `worker/` | Go services |
| `install/` | Old worker install scripts |
| `deploy/docker-compose.yml` | Local demo stack |

## Build (optional)

```bash
make queen worker   # or docker compose in deploy/
make web            # Queen console assets → queen/internal/ui
```

Do not add session/Agent features to `web/`; use `client/` instead.
