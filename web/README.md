# Legacy Queen web UI

**Not the Hive Nest client.** Day-to-day UI is [`../client/`](../client/). See [LEGACY.md](LEGACY.md).

React + Vite SPA embedded into the Queen binary (`go:embed`).

## Dev

```bash
export HIVENEST_BOOTSTRAP_TOKEN=hivenest-dev-token
./bin/queen

cd web && npm install && npm run dev
# http://127.0.0.1:5173/  (API proxied to Queen :8080)
```

## Production embed

```bash
npm run build   # → ../queen/internal/ui/dist
make queen-with-ui
```

Docker: `deploy/Dockerfile.queen`.
