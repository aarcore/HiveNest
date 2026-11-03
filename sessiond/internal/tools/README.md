# sessiond structured tools

`POST /v1/sessions/{id}/tools` runs Agent ops over the open SSH session.

## Tools

| Tool | Risk | Transport | Notes |
|------|------|-----------|--------|
| `list_files` | low | SFTP → `ls -la` | absolute or `~/…` path |
| `read_file` | low | SFTP → `head -c` | max 65536 bytes |
| `stat_path` | low | SFTP → `stat`/`ls -ld` | |
| `disk_free` | low | `df -hP` | optional path |
| `list_processes` | low | `ps auxww` + local parse | `pattern`, `user`, `limit` (default 100, max 500) |
| `write_file` | **medium** | SFTP → base64/`printf` exec | `content` max 65536; **Approve required** |
| `mkdir` | **medium** | SFTP `MkdirAll` → `mkdir -p` | **Approve required** |
| `remove_file` | **high** | SFTP `Remove` → `rm --` (no `-rf`) | **Approve required** |
| `rmdir` | **high** | SFTP `RemoveDirectory` → `rmdir` | refuses `/` and `~`; **Approve required** |

## Approve gate

Medium/high tools return **409** `approval_required` with `{ risk, tool, command }` where `command` is `DisplayCommand` (must match the proposal verbatim). After `POST …/proposals` → approve, re-POST `/tools` with `proposal_id` + `approve_token`.

Low-risk tools run immediately and are still audited as `session.tool`.

## Path rules

`SafePath` rejects `..`, shell metacharacters, and non-absolute paths (except `~/…`).
