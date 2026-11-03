# hivenest-sessiond

Local SSH session sidecar for Hive Nest. Listens on **loopback only**, authenticates with a bearer token, and speaks HTTP + WebSocket.

**Targets:** Windows, Linux, and macOS (`GOOS=windows|linux|darwin`). Develop on any of them; CI should cross-compile all three.

## Features (MVP)

- Host profile CRUD (JSON file under the OS data dir)
- Open SSH session (identity file, SSH agent, and/or **username/password at connect time**)
- **SSH known_hosts TOFU** (first connect shows fingerprint; accept/reject; mismatch rejects unless replace)
- **Jump host / ProxyJump** (`jump_host_ids[]` multi-hop chain, legacy `jump_host_id`, or OpenSSH-style `proxy_jump` / `b1,b2`)
- Interactive PTY over WebSocket
- One-shot `exec` with stdout/stderr/exit
- **Structured Agent tools** (`POST /v1/sessions/{id}/tools`): reads (`list_files`, `read_file`, `stat_path`, `disk_free`, `list_processes` with filters) risk `low`; `write_file`/`mkdir` **medium**; `remove_file`/`rmdir` **high** (Approve like exec). See [`internal/tools/README.md`](internal/tools/README.md).
- Proposal → approve → exec gate for medium/high-risk commands
- Local JSONL audit log

## Data directories (OS-aware)

| OS | Default data dir |
|----|------------------|
| macOS | `~/Library/Application Support/HiveNest/sessiond` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/hivenest/sessiond` |
| Windows | `%APPDATA%\HiveNest\sessiond` |

Override with `HIVENEST_SESSIOND_DATA`.

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `HIVENEST_SESSIOND_LISTEN` | `127.0.0.1:7788` | Must be loopback |
| `HIVENEST_SESSIOND_TOKEN` | auto-generated | API token (also written to `sessiond.token`) |
| `HIVENEST_SESSIOND_DATA` | (see table) | Config / hosts / audit |

## Password auth

Passwords are **connect-time only**:

- Send `password` (target), optional `jump_password`, and/or `jump_passwords` (map of bastion host id or `proxy:N`) on `POST /v1/sessions`.
- Host profiles may set `auth_method: "password"` so the UI prompts, but secrets are **not** written to `hosts.json`.
- **ProxyJump** (single or comma-separated multi-hop) never reuses the target **password or identity_file** for any hop. Prefer `jump_host_ids[]` so each hop uses that profile’s own key/auth. For string ProxyJump: `jump_hops[i]` (identity/auth per index), hop-0 also mirrored in `jump_identity_file` / `jump_auth_method`, plus connect-time `jump_passwords["proxy:N"]`.
- `jump_host_id` / `jump_host_ids` profiles with `auth_method: "password"` require `jump_password` or `jump_passwords[host_id]`.
- Do not put passwords in `identity_file`. Audit logs redact password substrings if an error ever echoed them.

## SSH agent notes

- **Linux / macOS:** `SSH_AUTH_SOCK` unix socket (OpenSSH `ssh-agent`).
- **Windows (best-effort, in order):**
  1. `SSH_AUTH_SOCK` if set
  2. Named pipe `\\.\pipe\openssh-ssh-agent` (Windows OpenSSH Authentication Agent service)
  3. **PuTTY Pageant** via in-process bridge (`go-pageant`) when Pageant is running
- If no agent is available, set `identity_file` on the host profile.

Identity paths accept `~/…` on Unix and `%USERPROFILE%\…` on Windows.

## Run

```bash
cd sessiond && go run ./cmd/sessiond
# or: make sessiond && ./bin/sessiond
```

Open the smoke UI: [http://127.0.0.1:7788/](http://127.0.0.1:7788/) and paste the token from the log or `sessiond.token`.

## API (sketch)

All `/v1/*` routes require `Authorization: Bearer <token>` or `X-HiveNest-Token` (WebSocket may use `?token=`).

- `GET/POST /v1/hosts`, `GET/PUT/DELETE /v1/hosts/{id}`
- `POST /v1/sessions` `{ "host_id", "password?", "jump_password?", "jump_passwords?", "accept_host_key?", "replace_host_key?" }` → session
  - **409** `host_key_unknown` / `host_key_mismatch` with fingerprint + public key (TOFU)
  - Password is never persisted; omit for key/agent hosts
- Host `auth_method`: `key` | `password` | `agent`; optional `jump_host_ids[]` / `jump_host_id` / `proxy_jump` (+ `jump_identity_file` / `jump_auth_method` / `jump_use_agent` for hop 0, and `jump_hops[]` for per-index ProxyJump string auth). Prefer `jump_host_ids` when each hop needs a full host profile.
- `GET /v1/known-hosts`, `POST /v1/known-hosts/accept`, `DELETE /v1/known-hosts?host=&port=`
- `GET /v1/sessions/{id}/ws` — PTY bytes (binary) + JSON `{type:resize,cols,rows}`
- `POST /v1/sessions/{id}/exec` `{ command, proposal_id?, approve_token?, actor? }`
- `POST /v1/sessions/{id}/tools` `{ tool, path?, pattern?, content?, user?, limit?, actor?, proposal_id?, approve_token? }` → result or **409** `approval_required`
- `POST /v1/sessions/{id}/proposals` → proposal; `POST /v1/proposals/{id}/approve|deny`
- `GET /v1/audit`

Low-risk commands may `exec` without a proposal; medium/high return `409 approval_required`.

## Locale / i18n

User-facing API errors and the smoke UI are **English** (primary). Structure leaves room for `zh-CN` (and others) in the client; sessiond keeps machine-stable `code` fields where relevant (`approval_required`).
