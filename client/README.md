# Hive Nest client

Active product UI: Vite + React + xterm.js → loopback **sessiond**.  
Legacy Queen console lives in `../web/` — do not use for session/Agent work.

## Dev (browser)

```bash
export HIVENEST_SESSIOND_TOKEN=dev-smoke-token
# sessiond on 127.0.0.1:7788
cd client && npm install && npm run dev
```

## Desktop (Tauri 2)

```bash
make -C .. sessiond
triple=$(rustc -vV | awk '/host:/ {print $2}')
cp ../bin/sessiond src-tauri/binaries/sessiond-$triple
npm run tauri:dev    # or: make -C .. tauri-dev
```

Sidecar naming: [src-tauri/README.md](./src-tauri/README.md).

## Highlights

- Host list, SSH auth, jump / ProxyJump, host-key TOFU
- Terminal + Agent (LLM providers, tools, MCP on desktop, skills)
- App + terminal themes; English-primary i18n
- Agent chat history per host (local)

## Tests

```bash
npm test
npm run build
```

Packaging: [../docs/11-desktop-packaging.md](../docs/11-desktop-packaging.md).
