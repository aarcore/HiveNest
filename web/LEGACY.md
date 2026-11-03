# Legacy: Queen console (`web/`)

**Status: quarantined — not the Hive Nest desktop/client UI.**

- Active product UI is **`../client/`** (Vite + React + xterm → sessiond).
- This tree only builds the **Queen** control-plane SPA embedded via `queen/internal/ui` (`go:embed`).
- Do **not** add Hive Nest session/Agent features here. Prefer `client/`.
- Rebuild Queen UI only when changing the Queen console: `make web` / `make queen-with-ui`.

Apple notarization / Authenticode are out of scope for this tree.
