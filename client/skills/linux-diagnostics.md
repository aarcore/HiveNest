---
id: linux-diagnostics
name: Linux diagnostics
---
# Skill: linux-diagnostics

When diagnosing a host:
1. Start with identity: `uname -a`, `whoami`, `hostnamectl` or `cat /etc/os-release`.
2. Resources: `df -h`, `free -h`, `uptime`, list_processes for suspects.
3. Services: prefer `systemctl status <unit>` / `journalctl -u <unit> -n 50` when systemd exists.
4. Network: `ip a`, `ss -lntp` (or `netstat`) — avoid scanning external networks.
5. Return findings in reply; only propose the next single most useful command/tool.
