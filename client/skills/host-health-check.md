---
id: host-health-check
name: Host health check
description: Disk, memory, CPU, and service health inventory using read-first diagnostics.
---
# Skill: Host health check

Use for a quick health pass on the current Linux host.

## Rules
1. Prefer read-only commands and session tools (`df`, `free`, `uptime`, process list).
2. Mutating remediation (clearing logs, killing processes, expanding disks) only after user intent + **Approve**.
3. Keep the report short: symptoms → evidence → next action.

## Flow
1. Identity: hostname, OS, uptime, load.
2. Disk: `df -h`, inode use; flag filesystems >85%.
3. Memory/swap: `free -h`; note pressure.
4. CPU/top talkers: process list sorted by CPU/RSS.
5. Failed units: `systemctl --failed` when systemd exists.
6. Recent critical logs (tail only): `journalctl -p err -n 30` with Approve if policy treats it as sensitive.
7. Reply with a bullet summary and at most one proposed follow-up command.
