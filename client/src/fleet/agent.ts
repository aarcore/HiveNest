/**
 * Fleet Agent loop.
 *
 * Same shape as the session Agent (model → action → observation → repeat) but the
 * unit of work is a server or a group, not a shell session. Actions are explicit
 * and few: list the roster, register a server, run a command on a target, finish.
 *
 * Passwords typed in chat are intercepted here and routed to the vault, never to
 * the model's read-back history.
 */

import { netFetch } from '../netFetch'
import { PROVIDER_META, type ProviderConfig } from '../settings/types'
import {
  addFleetServer,
  clearFleetCredentials,
  groupNames,
  loadFleet,
  rememberFleetPassword,
  resolveFleetRef,
  scrubSecrets,
  setFleetCredentials,
} from './roster'
import { formatBatch, runOnGroup, runOnServer } from './exec'
import type { FleetRunOutcome, FleetServer } from './types'

export const FLEET_MAX_STEPS = 30

const FLEET_SYSTEM = `You are Hive Nest Fleet, a careful Linux/Kubernetes operator working across MANY servers at once.
You are not attached to any single session. You choose which servers to touch on every step.

Reply with ONE JSON object, nothing else. Shapes:

1. Run a command on one server, a group, or every server:
{"action":"run","target":"<server name, host, or group>","command":"<single non-interactive shell command>","reason":"<short why>","reply":"<one sentence for the user>"}
Use "target":"all" for every server in the roster.

2. Inspect the roster (names, groups, roles, addresses):
{"action":"list","reply":"<optional sentence>"}

3. Register a new server. Include the password ONLY if the user supplied one:
{"action":"register","name":"k8s-master-1","host":"10.0.0.11","port":22,"user":"ubuntu","auth":"password","password":"<secret>","group":"prod-k8s","role":"control-plane","reply":"<one sentence>"}
Use "auth":"key" with "identity_file" for key auth, or "auth":"agent".

4. Store or update a password for an existing server:
{"action":"remember","target":"<server name>","password":"<secret>","reply":"<one sentence>"}

5. Finish:
{"action":"done","reply":"<summary of what happened and what is left>"}

Rules:
- One action per reply. Wait for the observation before deciding the next step.
- Never put a password in "command", "reason", or "reply".
- Prefer read-only checks first. Anything that writes, deletes, restarts services, or changes cluster state is fine to propose, but the runtime will ask the user to approve it.
- Cluster work goes one deliberate step at a time: check prerequisites, then install, then verify, then move to the next node.
- When listing nodes for a cluster, use the roster's "role" field to decide which machine is control-plane and which are workers.
- If a server is missing from the roster and the user gave you its address, register it before using it.
- If the user goal is satisfied, stop with "done". Do not keep exploring.`

export type FleetAction =
  | { kind: 'run'; target: string; command: string; reason: string }
  | { kind: 'list' }
  | { kind: 'register'; server: Parameters<typeof addFleetServer>[0] }
  | { kind: 'remember'; target: string; password: string }
  | { kind: 'done'; reply: string }

export type FleetSecrets = string[]

export type FleetStepEvent =
  | { type: 'assistant'; text: string }
  | { type: 'step'; label: string }
  | { type: 'result'; title: string; body: string; failed: boolean }
  | { type: 'note'; text: string }
  | { type: 'error'; text: string }
  | {
      type: 'approval'
      server: string
      command: string
      risk: 'low' | 'medium' | 'high'
      apply: () => Promise<void>
    }
  | { type: 'done'; text: string }

type ParsedReply = { action: FleetAction; secrets: FleetSecrets; text: string }

function stripFence(s: string): string {
  const t = s.trim()
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) return m[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return t.slice(start, end + 1)
  return t
}

/** Pull the JSON action out of a model reply, collecting any secrets it carried. */
export function parseFleetReply(raw: string): ParsedReply {
  const json = stripFence(raw)
  const secrets: FleetSecrets = []
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(json) as Record<string, unknown>
  } catch {
    return {
      action: { kind: 'done', reply: raw.trim().slice(0, 2000) || 'No action parsed.' },
      secrets,
      text: raw,
    }
  }
  const str = (k: string) => (typeof obj[k] === 'string' ? (obj[k] as string).trim() : '')
  const reply = str('reply')
  const action = str('action').toLowerCase() || 'done'

  if (action === 'run') {
    return {
      action: { kind: 'run', target: str('target') || 'all', command: str('command'), reason: str('reason') },
      secrets,
      text: raw,
    }
  }
  if (action === 'list') {
    return { action: { kind: 'list' }, secrets, text: raw }
  }
  if (action === 'register') {
    const password = str('password')
    const jumpPassword = str('jump_password')
    if (password) secrets.push(password)
    if (jumpPassword) secrets.push(jumpPassword)
    const auth = str('auth') as 'key' | 'password' | 'agent' | ''
    return {
      action: {
        kind: 'register',
        server: {
          name: str('name') || str('host'),
          host: str('host'),
          port: Number(obj.port) > 0 ? Number(obj.port) : 22,
          user: str('user') || 'root',
          auth_method: auth === 'key' || auth === 'password' || auth === 'agent' ? auth : '',
          identity_file: str('identity_file') || undefined,
          use_agent: auth === 'agent' ? true : undefined,
          group: str('group') || undefined,
          role: str('role') || undefined,
        },
      },
      secrets,
      // Register actions carry the secret; keep it out of the transcript.
      text: reply,
    }
  }
  if (action === 'remember') {
    const password = str('password')
    if (password) secrets.push(password)
    return {
      action: { kind: 'remember', target: str('target'), password },
      secrets,
      text: reply,
    }
  }
  return { action: { kind: 'done', reply: reply || 'Done.' }, secrets, text: reply || raw }
}

async function callModel(
  provider: ProviderConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const meta = PROVIDER_META[provider.id]
  if (meta.requiresApiKey && !provider.apiKey.trim()) throw new Error('API key not configured')
  if (!provider.apiBaseUrl.trim()) throw new Error('API base URL not configured')
  if (!provider.defaultModel.trim()) throw new Error('Default model not configured')

  const base = provider.apiBaseUrl.replace(/\/$/, '')
  const style = provider.id === 'custom' ? provider.orgOrRegion.trim().toLowerCase() : ''
  const url = style === 'anthropic' ? `${base}/v1/messages` : `${base}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (style === 'anthropic') {
    headers['x-api-key'] = provider.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (provider.apiKey.trim()) {
    headers.Authorization = `Bearer ${provider.apiKey}`
  }

  const payload =
    style === 'anthropic'
      ? {
          model: provider.defaultModel,
          max_tokens: 2048,
          system: FLEET_SYSTEM,
          messages: messages.filter((m) => m.role !== 'system'),
        }
      : { model: provider.defaultModel, temperature: 0.2, messages }

  const res = await netFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  if (style === 'anthropic') {
    const blocks = (body?.content || []) as { type: string; text?: string }[]
    const text = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n')
    if (!text) throw new Error('Empty model response')
    return text
  }
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content) throw new Error('Empty model response')
  return content
}

function rosterDigest(list: FleetServer[]): string {
  if (!list.length) return 'The roster is empty. Nothing has been registered yet.'
  const groups = groupNames(list)
  const lines = list.map((s) => {
    const bits = [`${s.name} (${s.user}@${s.host}:${s.port})`]
    if (s.group) bits.push(`group=${s.group}`)
    if (s.role) bits.push(`role=${s.role}`)
    bits.push(`auth=${s.auth_method || (s.identity_file ? 'key' : 'agent')}`)
    return `- ${bits.join(' · ')}`
  })
  return [`Roster (${list.length} servers${groups.length ? `, groups: ${groups.join(', ')}` : ''}):`, ...lines].join('\n')
}

export type FleetRunOptions = {
  provider: ProviderConfig
  userText: string
  history: { role: 'system' | 'user' | 'assistant'; content: string }[]
  maxSteps?: number
  signal?: { stopped: boolean }
  onEvent: (e: FleetStepEvent) => void
}

/** Run one user turn of the Fleet Agent, streaming step events as it goes. */
export async function runFleetTurn(opts: FleetRunOptions): Promise<void> {
  const { provider, userText, onEvent, maxSteps = FLEET_MAX_STEPS } = opts
  let history = [...opts.history]

  history.push({ role: 'user', content: userText })
  onEvent({ type: 'assistant', text: userText })
  let allSecrets: FleetSecrets = []

  for (let step = 1; step <= maxSteps; step += 1) {
    if (opts.signal?.stopped) return

    const roster = loadFleet()
    const systemPrompt = `${FLEET_SYSTEM}\n\n${rosterDigest(roster)}`
    let raw: string
    try {
      raw = await callModel(provider, [{ role: 'system', content: systemPrompt }, ...history])
    } catch (ex: unknown) {
      onEvent({ type: 'error', text: ex instanceof Error ? ex.message : String(ex) })
      return
    }

    const parsed = parseFleetReply(raw)
    allSecrets = [...allSecrets, ...parsed.secrets]
    history.push({ role: 'assistant', content: raw })
    history = history.slice(-24)

    const visible = scrubSecrets(parsed.text, allSecrets).trim()
    if (visible) onEvent({ type: 'assistant', text: visible })

    const action = parsed.action
    if (action.kind === 'done') {
      onEvent({ type: 'done', text: visible || 'Done.' })
      return
    }

    if (action.kind === 'list') {
      onEvent({ type: 'note', text: rosterDigest(roster) })
      history.push({ role: 'user', content: `Roster:\n${rosterDigest(roster)}` })
      continue
    }

    if (action.kind === 'register') {
      if (!action.server.host) {
        onEvent({ type: 'error', text: 'A server needs at least a host address.' })
        return
      }
      const created = addFleetServer(action.server)
      const pw = (parsed.secrets[0] || '').trim()
      if (pw && action.server.auth_method !== 'key') {
        await rememberFleetPassword(created, pw, false)
        setFleetCredentials({ [created.id]: { password: pw } })
      }
      onEvent({
        type: 'note',
        text: `Registered ${created.name} (${created.user}@${created.host}:${created.port})${
          created.group ? ` in group ${created.group}` : ''
        }${pw ? ' with a password' : ''}.`,
      })
      history.push({
        role: 'user',
        content: `Registered server ${created.name} at ${created.host}. Continue.`,
      })
      continue
    }

    if (action.kind === 'remember') {
      const [server] = resolveFleetRef(action.target)
      if (!server) {
        onEvent({ type: 'error', text: `No server matches "${action.target}".` })
        return
      }
      await rememberFleetPassword(server, action.password, false)
      onEvent({ type: 'note', text: `Stored a password for ${server.name} for this chat.` })
      history.push({ role: 'user', content: `Password stored for ${server.name}. Continue.` })
      continue
    }

    // run
    if (!action.command.trim()) {
      onEvent({ type: 'error', text: 'The model asked to run an empty command.' })
      return
    }
    const targets =
      action.target.toLowerCase() === 'all' ? loadFleet() : resolveFleetRef(action.target)
    if (!targets.length) {
      onEvent({
        type: 'error',
        text: `No server or group matches "${action.target}". Register it first, or ask me to list the roster.`,
      })
      return
    }

    onEvent({
      type: 'step',
      label:
        targets.length === 1
          ? `${targets[0].name}: ${action.command}`
          : `${targets.length} servers: ${action.command}`,
    })

    let outcomes: FleetRunOutcome[]
    if (targets.length === 1) {
      outcomes = [
        await runOnServer(targets[0], action.command, {
          propose: async (server, command, reason, risk) => {
            onEvent({
              type: 'approval',
              server: server.name,
              command,
              risk,
              apply: async () => {
                // Re-running through the main UI path keeps one approval source of
                // truth: the user approves, then we run the same command again.
                onEvent({ type: 'note', text: `Approved on ${server.name}: ${command} (${reason})` })
              },
            })
          },
        }),
      ]
    } else {
      outcomes = await runOnGroup(targets, action.command)
    }

    const body = formatBatch(targets, outcomes)
    const failed = outcomes.some((o) => o.type !== 'ok' || o.exit_code !== 0)
    onEvent({ type: 'result', title: targets.map((s) => s.name).join(', '), body, failed })
    history.push({ role: 'user', content: `Observation:\n${scrubSecrets(body, allSecrets)}` })
  }

  onEvent({ type: 'note', text: `Reached the ${maxSteps}-step limit for this turn.` })
}

export function resetFleetChatState() {
  clearFleetCredentials()
}
