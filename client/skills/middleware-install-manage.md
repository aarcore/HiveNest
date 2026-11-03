---
id: middleware-install-manage
name: Middleware install & manage
description: Install and manage nginx, Redis, MySQL/Postgres with scoped, Approve-gated commands.
---
# Skill: Middleware install & manage

Use for nginx, Redis, MySQL, or PostgreSQL on the current Linux host.

## Scope
- Supported targets: **nginx**, **redis**, **mysql** / **mariadb**, **postgresql**.
- One service at a time unless the user lists several.
- Prefer distro packages (`apt`/`dnf`/`yum`) over random remote scripts.

## Rules
1. Read-only discovery first: package manager, existing units (`systemctl status`), listening ports (`ss -lntp`).
2. Propose exact install/enable/restart commands; wait for **Approve** before mutating.
3. Do not change bind addresses to `0.0.0.0` or open firewall holes unless the user explicitly asks.
4. Do not set or print DB root passwords in chat; prefer prompting the user or using `--ask-pass` style flows they control.
5. Config edits: read the file first; prefer small diffs; Approve writes.
6. After install, verify with `systemctl status` / a local health check only.

## Suggested flow
1. Confirm which middleware and desired version/channel.
2. Inventory conflicts (port in use, old packages).
3. Install → enable → status (separate Approves if risky).
4. Optional: minimal hardened defaults (localhost bind for DBs) when user wants exposure limited.
5. Summarize unit name, config path, and next safe ops (reload, logs).
