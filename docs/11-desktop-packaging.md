# Desktop packaging (Tauri 2 + sessiond sidecar)

English is the primary product language. Build artifacts are unsigned by default.

## Overview

| Piece | Role |
|-------|------|
| `client/` | Vite + React UI |
| `client/src-tauri/` | Tauri 2 shell |
| `sessiond` | Local loopback SSH sidecar (`127.0.0.1:7788`) bundled as `externalBin` |

Tauri expects sidecar filenames:

```
client/src-tauri/binaries/sessiond-<rust-target-triple>[.exe]
```

Examples:

- `sessiond-aarch64-apple-darwin`
- `sessiond-x86_64-apple-darwin`
- `sessiond-x86_64-unknown-linux-gnu`
- `sessiond-aarch64-unknown-linux-gnu`
- `sessiond-x86_64-pc-windows-msvc.exe`

## Prepare all sidecars

From the repo root:

```bash
make prepare-sidecars
# or: make release-sessiond   # also writes dist/hivenest-sessiond-*
```

Cross-compiles sessiond with `CGO_ENABLED=0` for darwin/linux/windows.

## Dev

```bash
# optional: run sessiond yourself
export HIVENEST_SESSIOND_TOKEN=dev-smoke-token
make sessiond && ./bin/sessiond

# UI only
make client-dev
# http://127.0.0.1:5173/

# Desktop shell (spawns sidecar if :7788 is free)
make tauri-dev
```

## Production build (this machine)

```bash
make tauri-build
# runs: native sessiond → copy sidecar for host triple → npm run tauri:build
```

Artifacts land under:

```
client/src-tauri/target/release/bundle/
```

macOS: `.app` / `.dmg`  
Linux: `.deb` / AppImage (depending on host packages)  
Windows: build on Windows (or CI) for `.msi` / `.exe`

Unsigned builds are expected for local/dev. Do **not** distribute unsigned macOS builds widely without notarization.

## Code signing & notarization (manual)

Hive Nest does **not** automate Apple notarization or Windows Authenticode in this repo.

### macOS (manual checklist)

1. Obtain an Apple Developer ID Application certificate.
2. Set Tauri signing env vars (see [Tauri macOS signing](https://v2.tauri.app/distribute/sign-macos/)), e.g. `APPLE_SIGNING_IDENTITY`, and optionally notarization credentials (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
3. `make tauri-build` on a Mac with Xcode tooling.
4. Notarize / staple with `xcrun notarytool` + `xcrun stapler` if not handled by the Tauri bundler env.
5. Verify Gatekeeper: `spctl --assess --type execute <App>.app`

### Windows (manual checklist — placeholders only)

1. Obtain an Authenticode certificate (not stored in this repo).
2. Configure Tauri Windows signing via env / `tauri.conf.json` `bundle.windows` — for example placeholders:
   - `certificateThumbprint`
   - `timestampUrl`
   - or CI secrets such as `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` (base64 PFX) per [Tauri Windows signing](https://v2.tauri.app/distribute/sign-windows/).
3. Build on Windows CI or a Windows machine: `make prepare-sidecars` then `npm run tauri:build` in `client/`.
4. Verify signature with `signtool verify /pa <installer.exe>` after you sign locally.

### Linux

No Apple/Microsoft store signing. Ship `.deb`/AppImage; optional distro packaging is out of scope for MVP.

## CI matrix (GitHub Actions)

Workflow: [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)

| Job | Runner | Output (unsigned) |
|-----|--------|-------------------|
| `sessiond-sidecars` | ubuntu | All `client/src-tauri/binaries/sessiond-*` triples |
| `tauri-linux` | ubuntu-22.04 | `.deb` / AppImage under `bundle/` |
| `tauri-windows` | windows-latest | NSIS `.exe` / `.msi` under `bundle/` |
| `tauri-macos` | macos-14 | `.app` + optional `dist/HiveNest-unsigned.dmg` via `make-dmg` |

Triggers on pushes/PRs touching `client/`, `sessiond/`, `Makefile`, or the workflow. Artifacts upload as `hivenest-*-unsigned`. **No signing secrets** are required or expected.

### Local Linux (unsigned AppImage / deb)

On an Ubuntu/Debian machine with Rust + Node 22+:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev   librsvg2-dev patchelf libssl-dev
make prepare-sidecars
make sessiond
triple=$(rustc -vV | awk '/host:/ {print $2}')
cp bin/sessiond "client/src-tauri/binaries/sessiond-$triple"
cd client && npm ci
# Override repo default bundle.targets (["app"] for macOS DMG path):
npx tauri build --bundles deb,appimage
# → client/src-tauri/target/release/bundle/deb/*.deb
# → client/src-tauri/target/release/bundle/appimage/*.AppImage
```

Or set `"bundle": { "targets": ["deb", "appimage"] }` in `tauri.conf.json` for Linux-only artifacts.

### Local Windows (unsigned NSIS / MSI)

On Windows (PowerShell or Git Bash) with Rust + Node + WebView2:

```bash
make prepare-sidecars
make sessiond
# copy sidecar for host triple, e.g. sessiond-x86_64-pc-windows-msvc.exe
cd client && npm ci
npx tauri build --bundles nsis,msi
# → bundle/nsis/*.exe  and/or  bundle/msi/*.msi
```

Authenticode signing is **not** automated — see checklist below (placeholder env only).

### Local macOS

```bash
make tauri-build-unsigned   # .app (bundle targets currently ["app"])
make make-dmg               # dist/HiveNest-unsigned.dmg (hdiutil, no Finder)
```

## Security reminders

- sessiond must bind **loopback only**.
- API token (`HIVENEST_SESSIOND_TOKEN`) stays on the machine; UI stores a copy in localStorage for the desktop/web client.
- SSH passwords and `jump_password` are connect-time only and must never be written to `hosts.json`.
- ProxyJump bastion auth uses `jump_identity_file` / `jump_auth_method` / `jump_password` — never the target `identity_file` or password.

## macOS DMG (no Finder Automation)

Creating a `.dmg` via Tauri’s `bundle_dmg.sh` sends Apple Events to Finder. Unattended / agent builds often hit:

`Not authorised to send Apple events to Finder (-1743)`

**Preferred path (this repo):** build the `.app`, then create a UDZO DMG with `hdiutil` only (no `osascript`, no Finder):

```bash
make tauri-build-unsigned   # produces client/src-tauri/target/release/bundle/macos/Hive Nest.app
make make-dmg               # -> dist/HiveNest-unsigned.dmg
# or: bash scripts/make-dmg.sh "$APP" dist/HiveNest-unsigned.dmg
```

If Tauri still tries to build a DMG and fails, set bundle targets to app-only:

```json
// client/src-tauri/tauri.conf.json
"bundle": { "targets": ["app"] }
```

Then run `make make-dmg`. Notarization / signing remain manual (see above).

Note: on newer macOS, `hdiutil create` may print a deprecation warning favoring `diskutil image create`; the UDZO image still builds successfully with `hdiutil` today.

