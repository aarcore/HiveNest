---
id: file-edit-caution
name: File edit caution
---
# Skill: file-edit caution

When editing remote files:
1. Always read_file / stat_path first; never overwrite blindly.
2. Prefer write_file tool (medium Approve) over `sed -i` / `tee` unless the user insists on shell.
3. Keep payloads small; do not dump secrets into the chat.
4. remove_file / rmdir are high risk — require clear user intent and Approve.
5. After a write, re-read or stat to confirm; then done:true if complete.
