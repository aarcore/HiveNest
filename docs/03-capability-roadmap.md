# Capability roadmap

## Phase A — MVP (current)

| Area | Status |
|------|--------|
| Host profiles + SSH connect (key, password, agent, jump, ProxyJump, TOFU) | Shipped |
| Interactive PTY + multi-tab sessions | Shipped |
| Agent panel + LLM providers + approve gate | Shipped |
| Structured sessiond tools + exec | Shipped |
| Local audit | Shipped |
| Tauri 2 shell + sidecar | Shipped (unsigned builds) |

**Acceptance:** complete “SSH in → terminal → Agent proposes → user approves → command runs” **without** Queen/Worker Docker.

## Phase B — depth

- Import `~/.ssh/config`; richer known_hosts management UI
- SFTP browser; configurable risk policy (read-auto vs confirm-all)
- Terminal scrollback snippets for Agent context (local, truncated)

## Phase C — optional host agent

- Small on-target daemon for deep metrics / offline buffer — only if SSH is not enough
- Reuse ideas from legacy `worker/`; not the default UX

## Phase D — optional cloud / team

- Encrypted host profile sync; shared policies
- Trimmed Queen as sync backend only — not the daily terminal entry point

## Explicitly deferred

- Fleet-first outbound Worker model as default
- Unattended destructive automation
- Windows SSH targets (Linux sshd first)
- Full EDR / multi-active control plane
