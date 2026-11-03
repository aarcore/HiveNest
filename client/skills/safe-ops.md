---
id: safe-ops
name: Safe ops checklist
---
# Skill: safe-ops checklist

Before proposing any mutating command or write tool:
1. Prefer read-only discovery (list_files, read_file, disk_free, list_processes, uname, df, free).
2. Never run `rm -rf /`, disk wipe, `mkfs`, or mass chmod/chown without an explicit user request.
3. Prefer scoped paths; quote shell arguments; avoid piping untrusted input into sh.
4. For writes: use write_file/mkdir tools (Approve) instead of shell redirection when possible.
5. Summarize risk in the reason field; set done:true when the user's question is answered.
