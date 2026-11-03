/** Local Agent skills (markdown) — bundled presets + user-uploaded custom skills. */

export type SkillMeta = {
  id: string
  name: string
  description: string
  /** Markdown body injected into the Agent system prompt when enabled. */
  body: string
  builtin: boolean
  /** When false, new installs leave this skill off until the user enables it. */
  defaultEnabled?: boolean
}

export type CustomSkill = {
  id: string
  name: string
  description: string
  body: string
}

const SAFE_OPS = `# Skill: safe-ops checklist

Before proposing any mutating command or write tool:
1. Prefer read-only discovery (list_files, read_file, disk_free, list_processes, uname, df, free).
2. Never run \`rm -rf /\`, disk wipe, \`mkfs\`, or mass chmod/chown without an explicit user request.
3. Prefer scoped paths; quote shell arguments; avoid piping untrusted input into sh.
4. For writes: use write_file/mkdir tools (Approve) instead of shell redirection when possible.
5. Summarize risk in the reason field; set done:true when the user's question is answered.
`

const LINUX_DIAG = `# Skill: linux-diagnostics

When diagnosing a host:
1. Start with identity: \`uname -a\`, \`whoami\`, \`hostnamectl\` or \`cat /etc/os-release\`.
2. Resources: \`df -h\`, \`free -h\`, \`uptime\`, list_processes for suspects.
3. Services: prefer \`systemctl status <unit>\` / \`journalctl -u <unit> -n 50\` when systemd exists.
4. Network: \`ip a\`, \`ss -lntp\` (or \`netstat\`) — avoid scanning external networks.
5. Return findings in reply; only propose the next single most useful command/tool.
`

const FILE_EDIT = `# Skill: file-edit caution

When editing remote files:
1. Always read_file / stat_path first; never overwrite blindly.
2. Prefer write_file tool (medium Approve) over \`sed -i\` / \`tee\` unless the user insists on shell.
3. Keep payloads small; do not dump secrets into the chat.
4. remove_file / rmdir are high risk — require clear user intent and Approve.
5. After a write, re-read or stat to confirm; then done:true if complete.
`

const K8S_SETUP = `# Skill: Kubernetes cluster setup

Use when the user asks to build, bootstrap, or join a Kubernetes cluster on the **current SSH session host**.

## Rules
1. Stay on this host only; never pivot to other machines unless the user names them and opens that session.
2. Every install/join/write goes through visible Command Proposals → **Approve**. Never silently mutate.
3. Detect OS first (\`cat /etc/os-release\`, \`uname -m\`). Prefer the user's chosen distro path (kubeadm, k3s, or microk8s) — ask once if unspecified.
4. Prefer idempotent checks before install: \`command -v kubectl\`, \`systemctl is-active containerd|crio|docker\`, existing \`/etc/kubernetes\`.
5. Do not disable swap, open firewall ports, or rewrite sysctl until the user confirms the plan.
6. Never download unsigned install scripts into a pipe without stating the URL and getting Approve for the exact command.

## Suggested flow
1. Inventory: OS, CPU/RAM/disk, swap, kernel modules (\`br_netfilter\`), cgroup v2.
2. Propose a short plan (single-node vs control-plane+worker; CNI choice).
3. Install runtime + kube tools with package manager when possible.
4. \`kubeadm init\` / \`k3s\` install / equivalent — one Approve step at a time.
5. Show kubeconfig location and a smoke test (\`kubectl get nodes\`) after Approve.
6. Stop with a clear summary; do not auto-install addons (Ingress, cert-manager) unless asked.
`

const MIDDLEWARE = `# Skill: Middleware install & manage

Use for nginx, Redis, MySQL, or PostgreSQL on the current Linux host.

## Scope
- Supported targets: **nginx**, **redis**, **mysql** / **mariadb**, **postgresql**.
- One service at a time unless the user lists several.
- Prefer distro packages (\`apt\`/\`dnf\`/\`yum\`) over random remote scripts.

## Rules
1. Read-only discovery first: package manager, existing units (\`systemctl status\`), listening ports (\`ss -lntp\`).
2. Propose exact install/enable/restart commands; wait for **Approve** before mutating.
3. Do not change bind addresses to \`0.0.0.0\` or open firewall holes unless the user explicitly asks.
4. Do not set or print DB root passwords in chat; prefer prompting the user or using ask-pass style flows they control.
5. Config edits: read the file first; prefer small diffs; Approve writes.
6. After install, verify with \`systemctl status\` / a local health check only.

## Suggested flow
1. Confirm which middleware and desired version/channel.
2. Inventory conflicts (port in use, old packages).
3. Install → enable → status (separate Approves if risky).
4. Optional: minimal hardened defaults (localhost bind for DBs) when user wants exposure limited.
5. Summarize unit name, config path, and next safe ops (reload, logs).
`

const VULN_CHECK = `# Skill: Vulnerability check

Use for host hardening reviews and common vulnerability / misconfiguration checks on the current Linux host.

## Rules
1. Start with a **non-destructive checklist** (no package install yet).
2. Prefer tools already present: \`lynis\`, \`trivy\`, \`osquery\`. If missing, propose install and wait for **Approve**.
3. Never run exploit PoCs, credential stuffing, or scans against third-party hosts.
4. External image/repo pulls (e.g. trivy DB) need an explicit Approve of the exact command.
5. Report findings with severity and remediation suggestions; do not auto-apply hardening unless asked.

## Checklist (always)
- OS release, uname, pending updates (\`apt list --upgradable\` / \`dnf check-update\`) — read-only.
- Listening services and unexpected open ports.
- SSH: PermitRootLogin / PasswordAuthentication via \`sshd -T\` when available (read-only).
- World-writable dirs in sensitive paths; SUID surprises (scoped \`find\`, not whole \`/\`).
- Firewall state (\`nft\`/\`iptables\`/\`firewalld\`/\`ufw\`) — status only until asked to change.

## Optional tool path
1. Detect tool → if absent, propose package or official install with Approve.
2. Run audit in read-only / report mode.
3. Summarize top issues; offer follow-up fixes as separate proposals.
`

const MALWARE = `# Skill: Malware / virus scan

Use when the user wants antivirus / malware scanning on the current Linux host (typically ClamAV).

## Rules
1. Do **not** start installs or full-disk scans until the user confirms scope (paths, schedule).
2. Every \`apt\`/\`dnf\` install, \`freshclam\`, and \`clamscan\`/\`clamdscan\` must be a visible proposal → **Approve**.
3. Prefer scanning user-specified directories first; avoid \`/\` full scans unless explicitly requested (slow, high I/O).
4. Never quarantine/delete matches automatically; report paths and ask before removal.
5. Do not download unofficial virus definitions.

## Suggested flow
1. Check for existing ClamAV (\`clamscan -V\`, systemd units).
2. If missing, propose distro packages (\`clamav\`, \`clamav-daemon\` / \`freshclam\`) with Approve.
3. Update definitions (\`freshclam\`) with Approve.
4. Run a scoped scan (e.g. \`/home\`, \`/var/www\`) with explicit flags; stream progress via command output.
5. Summarize infected/suspicious counts; propose delete/quarantine only on request.
`

const HOST_HEALTH = `# Skill: Host health check

Use for a quick health pass on the current Linux host.

## Rules
1. Prefer read-only commands and session tools (\`df\`, \`free\`, \`uptime\`, process list).
2. Mutating remediation (clearing logs, killing processes, expanding disks) only after user intent + **Approve**.
3. Keep the report short: symptoms → evidence → next action.

## Flow
1. Identity: hostname, OS, uptime, load.
2. Disk: \`df -h\`, inode use; flag filesystems >85%.
3. Memory/swap: \`free -h\`; note pressure.
4. CPU/top talkers: process list sorted by CPU/RSS.
5. Failed units: \`systemctl --failed\` when systemd exists.
6. Recent critical logs (tail only): \`journalctl -p err -n 30\` with Approve if policy treats it as sensitive.
7. Reply with a bullet summary and at most one proposed follow-up command.
`

const FIREWALL = `# Skill: Firewall basics

Use to inspect or adjust host firewall policy on the current Linux session.

## Rules
1. **Inspect first**: detect backend (\`ufw\`, \`firewalld\`, \`nft\`, \`iptables-save\`).
2. Show current rules before any change.
3. Default posture: do not disable the firewall; do not flush all rules.
4. Every allow/deny/reload is a separate visible proposal → **Approve**.
5. Prefer adding a single port/service rule over broad ALLOW ANY.
6. Warn before changes that could lock the user out of SSH (port 22/custom); confirm management port first.

## Flow
1. Status dump (read-only).
2. Confirm desired outcome (e.g. allow 80/443, deny others).
3. Propose minimal rule changes + reload.
4. Re-read status; summarize.
`

export const BUILTIN_SKILLS: SkillMeta[] = [
  {
    id: 'safe-ops',
    name: 'Safe ops checklist',
    description: 'Guardrails before mutating commands and write tools.',
    body: SAFE_OPS.trim(),
    builtin: true,
    defaultEnabled: true,
  },
  {
    id: 'linux-diagnostics',
    name: 'Linux diagnostics',
    description: 'Ordered discovery steps for host troubleshooting.',
    body: LINUX_DIAG.trim(),
    builtin: true,
    defaultEnabled: true,
  },
  {
    id: 'file-edit-caution',
    name: 'File edit caution',
    description: 'Read-before-write and Approve guidance for remote files.',
    body: FILE_EDIT.trim(),
    builtin: true,
    defaultEnabled: true,
  },
  {
    id: 'kubernetes-cluster-setup',
    name: 'Kubernetes cluster setup',
    description: 'Guided kubeadm/k3s-style cluster build-out via Approve.',
    body: K8S_SETUP.trim(),
    builtin: true,
    defaultEnabled: false,
  },
  {
    id: 'middleware-install-manage',
    name: 'Middleware install & manage',
    description: 'nginx, Redis, MySQL/Postgres — scoped installs with Approve.',
    body: MIDDLEWARE.trim(),
    builtin: true,
    defaultEnabled: false,
  },
  {
    id: 'vulnerability-check',
    name: 'Vulnerability check',
    description: 'Hardening checklist; optional lynis/trivy with Approve.',
    body: VULN_CHECK.trim(),
    builtin: true,
    defaultEnabled: false,
  },
  {
    id: 'malware-scan',
    name: 'Malware / virus scan',
    description: 'ClamAV install + scoped scan pattern with Approve.',
    body: MALWARE.trim(),
    builtin: true,
    defaultEnabled: false,
  },
  {
    id: 'host-health-check',
    name: 'Host health check',
    description: 'Disk, memory, CPU, and failed-unit health inventory.',
    body: HOST_HEALTH.trim(),
    builtin: true,
    defaultEnabled: false,
  },
  {
    id: 'firewall-basics',
    name: 'Firewall basics',
    description: 'Inspect/change ufw/firewalld/nftables with explicit Approve.',
    body: FIREWALL.trim(),
    builtin: true,
    defaultEnabled: false,
  },
]

export type SkillsSettings = {
  /** Skill ids that are enabled. Missing id => use SkillMeta.defaultEnabled (true if unset). */
  enabled: Record<string, boolean>
  /** Optional extra markdown skills uploaded by the user (persisted). */
  custom: CustomSkill[]
}

export function isSkillEnabled(settings: SkillsSettings, skill: SkillMeta): boolean {
  if (Object.prototype.hasOwnProperty.call(settings.enabled, skill.id)) {
    return settings.enabled[skill.id] !== false
  }
  return skill.defaultEnabled !== false
}

export function defaultSkillsSettings(): SkillsSettings {
  const enabled: Record<string, boolean> = {}
  for (const s of BUILTIN_SKILLS) enabled[s.id] = s.defaultEnabled !== false
  return { enabled, custom: [] }
}

export function listSkills(settings: SkillsSettings): SkillMeta[] {
  const custom: SkillMeta[] = (settings.custom || []).map((c) => ({
    ...c,
    builtin: false,
    defaultEnabled: true,
  }))
  return [...BUILTIN_SKILLS, ...custom]
}

export function buildSkillsPrompt(settings: SkillsSettings): string {
  const all = listSkills(settings)
  const enabled = all.filter((s) => isSkillEnabled(settings, s))
  if (!enabled.length) return ''
  return (
    'Enabled Agent skills (follow when relevant):\n\n' +
    enabled.map((s) => s.body).join('\n\n')
  )
}

const ID_RE = /^[a-z][a-z0-9-]{1,62}$/

export function slugifySkillId(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  if (ID_RE.test(s)) return s
  return `skill-${s || 'upload'}`.replace(/[^a-z0-9-]/g, '').slice(0, 63)
}

/** Parse YAML-ish frontmatter (id/name/description) + markdown body. */
export function parseSkillMarkdown(
  text: string,
  fallbackName = 'Uploaded skill',
): CustomSkill {
  const raw = text.replace(/^\uFEFF/, '')
  let id = ''
  let name = ''
  let description = ''
  let body = raw.trim()

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (fm) {
    const head = fm[1]
    body = fm[2].trim()
    for (const line of head.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
      if (!m) continue
      const key = m[1].toLowerCase()
      const val = m[2].trim().replace(/^["']|["']$/g, '')
      if (key === 'id') id = val
      else if (key === 'name' || key === 'title') name = val
      else if (key === 'description' || key === 'desc') description = val
    }
  }

  if (!name) {
    const h1 = body.match(/^#\s+(.+)$/m)
    name = (h1?.[1] || fallbackName).trim()
  }
  if (!id) id = slugifySkillId(name)
  else id = slugifySkillId(id)

  if (!ID_RE.test(id)) {
    throw new Error(`Invalid skill id "${id}" (use lowercase letters, digits, hyphens)`)
  }
  if (!body) throw new Error('Skill body is empty')
  if (!name) throw new Error('Skill name is required')
  if (!description) {
    description = body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'))?.trim() || name
    if (description.length > 140) description = description.slice(0, 137) + '…'
  }

  return { id, name, description, body }
}

export function validateCustomSkill(
  skill: CustomSkill,
  settings: SkillsSettings,
  opts?: { replaceId?: string },
): void {
  if (!ID_RE.test(skill.id)) throw new Error(`Invalid skill id "${skill.id}"`)
  if (!skill.name.trim()) throw new Error('Skill name is required')
  if (!skill.body.trim()) throw new Error('Skill body is empty')
  if (BUILTIN_SKILLS.some((b) => b.id === skill.id)) {
    throw new Error(`Skill id "${skill.id}" is reserved for a built-in preset`)
  }
  const others = (settings.custom || []).filter((c) => c.id !== opts?.replaceId)
  if (others.some((c) => c.id === skill.id)) {
    throw new Error(`A custom skill with id "${skill.id}" already exists`)
  }
}

/** Upsert a custom skill into settings (immutable). */
export function upsertCustomSkill(
  settings: SkillsSettings,
  skill: CustomSkill,
  opts?: { replaceExisting?: boolean },
): SkillsSettings {
  const existing = (settings.custom || []).find((c) => c.id === skill.id)
  if (existing && !opts?.replaceExisting) {
    validateCustomSkill(skill, settings)
  } else {
    validateCustomSkill(skill, settings, { replaceId: existing?.id })
  }
  const custom = existing
    ? (settings.custom || []).map((c) => (c.id === skill.id ? skill : c))
    : [...(settings.custom || []), skill]
  return {
    enabled: { ...settings.enabled, [skill.id]: true },
    custom,
  }
}

export function removeCustomSkill(settings: SkillsSettings, id: string): SkillsSettings {
  const custom = (settings.custom || []).filter((c) => c.id !== id)
  const enabled = { ...settings.enabled }
  delete enabled[id]
  return { enabled, custom }
}
