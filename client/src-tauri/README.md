# Hive Nest desktop (Tauri 2)

Wraps the Vite React client and spawns **sessiond** as a sidecar (`binaries/sessiond-*`).

Full packaging, signing, and notarization notes: [docs/11-desktop-packaging.md](../../docs/11-desktop-packaging.md).

## Prerequisites

- Rust stable + `cargo`
- Node 20+
- macOS 11+ / Windows 10+ / modern Linux (WebKitGTK on Linux)

## Prepare sessiond sidecar binaries

```bash
# from repo root — builds all target triples Tauri expects
make prepare-sidecars
```

## Dev (Mac)

```bash
# Terminal A (optional): run sessiond yourself — app detects :7788 and skips sidecar
export HIVENEST_SESSIOND_TOKEN=dev-smoke-token
make sessiond && ./bin/sessiond

# Terminal B
make tauri-dev
# or: cd client && npm install && npm run tauri:dev
```

## Production build

```bash
# from repo root (unsigned OK for local testing)
make tauri-build
# artifacts: client/src-tauri/target/release/bundle/
```

**Notarization / Authenticode are manual** — see [docs/11-desktop-packaging.md](../../docs/11-desktop-packaging.md).

## Notes

- sessiond **must** bind loopback only (`127.0.0.1:7788`).
- UI talks to sessiond via Vite proxy in `dev`, or direct `http://127.0.0.1:7788` when packaged.
- Cross-platform: prefer building each OS on that OS (or CI matrix). Sidecar name must match the Rust target triple suffix.
