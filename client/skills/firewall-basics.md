---
id: firewall-basics
name: Firewall basics
description: Inspect and carefully change ufw/firewalld/nftables with explicit Approve.
---
# Skill: Firewall basics

Use to inspect or adjust host firewall policy on the current Linux session.

## Rules
1. **Inspect first**: detect backend (`ufw`, `firewalld`, `nft`, `iptables-save`).
2. Show current rules before any change.
3. Default posture: do not disable the firewall; do not flush all rules.
4. Every allow/deny/reload is a separate visible proposal → **Approve**.
5. Prefer adding a single port/service rule over broad `ALLOW ANY`.
6. Warn before changes that could lock the user out of SSH (port 22/custom); confirm management port first.

## Flow
1. Status dump (read-only).
2. Confirm desired outcome (e.g. allow 80/443, deny others).
3. Propose minimal rule changes + reload.
4. Re-read status; summarize.
