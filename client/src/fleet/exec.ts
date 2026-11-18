/**
 * Fleet execution: open a throwaway session per server, run one command, close.
 *
 * Sessions are created from *inline* connection details, so a chat that touches
 * twelve machines never adds twelve entries to the user's host list. Each server
 * gets a fresh SSH connection for each command; that keeps fleet work isolated
 * from the terminal tabs and guarantees a stale credential cannot be reused
 * silently after the user changes it.
 */

import {
  closeSession,
  execCommand,
  openInlineSession,
  type ApiError,
  type SessionInfo,
} from '../api'
import { credentialsFor } from './roster'
import type { FleetRunOutcome, FleetServer } from './types'

/** How long one fleet command may take before we give up on it. */
const RUN_TIMEOUT_MS = 120_000

export type FleetExecHooks = {
  /** Called when sessiond demands approval for a medium/high command. */
  propose?: (
    server: FleetServer,
    command: string,
    reason: string,
    risk: 'low' | 'medium' | 'high',
  ) => Promise<void>
}

function isHostKeyError(err: ApiError): boolean {
  return err.status === 409 && (err.body?.code === 'host_key_unknown' || err.body?.code === 'host_key_mismatch')
}

async function connect(server: FleetServer, acceptHostKey: boolean): Promise<SessionInfo> {
  const cred = await credentialsFor(server)
  return openInlineSession({
    name: server.name,
    host: server.host,
    port: server.port,
    user: server.user,
    identity_file: server.identity_file,
    use_agent: server.use_agent ?? !server.identity_file,
    auth_method: server.auth_method,
    password: cred.password,
    accept_host_key: acceptHostKey,
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Run one command on one server. Never throws: failures become error outcomes. */
export async function runOnServer(
  server: FleetServer,
  command: string,
  hooks: FleetExecHooks = {},
): Promise<FleetRunOutcome> {
  const cmd = command.trim()
  if (!cmd) return { type: 'error', server: server.name, command, message: 'Empty command' }

  let sessionId: string | null = null
  try {
    let opened: SessionInfo
    try {
      opened = await connect(server, false)
    } catch (ex: unknown) {
      const err = ex as ApiError
      if (!isHostKeyError(err)) throw err
      if (err.body?.code === 'host_key_mismatch') {
        const prev = err.body?.host_key?.previous_fingerprint || 'unknown'
        throw new Error(
          `Host key for ${server.host} changed (was ${prev}). Refusing to connect until it is confirmed in the main UI.`,
        )
      }
      // First contact: TOFU, same as a normal connect where the user accepted.
      opened = await connect(server, true)
    }
    sessionId = opened.id

    const started = Date.now()
    const result = await withTimeout(
      execCommand(sessionId, { command: cmd, actor: 'agent' }),
      RUN_TIMEOUT_MS,
      `Command on ${server.name}`,
    )
    return {
      type: 'ok',
      server: server.name,
      command: cmd,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms || Date.now() - started,
    }
  } catch (ex: unknown) {
    const err = ex as ApiError
    if (err.status === 409 && err.body?.code === 'approval_required') {
      const risk = (err.body?.risk as 'low' | 'medium' | 'high') || 'medium'
      const display = (err.body?.command as string) || cmd
      // The session is throwaway, so there is nothing to approve against. Tell the
      // caller instead of retrying: the command did not run.
      await hooks.propose?.(server, display, 'Fleet command needs approval', risk)
      return {
        type: 'approval_required',
        server: server.name,
        command: display,
        reason: 'Fleet command needs approval',
        risk,
      }
    }
    return {
      type: 'error',
      server: server.name,
      command: cmd,
      message: err?.message || String(ex),
    }
  } finally {
    if (sessionId) {
      try {
        await closeSession(sessionId)
      } catch {
        /* ignore */
      }
    }
  }
}

/** Run one command against many servers, sequentially to keep load predictable. */
export async function runOnGroup(
  servers: FleetServer[],
  command: string,
  hooks: FleetExecHooks = {},
): Promise<FleetRunOutcome[]> {
  const out: FleetRunOutcome[] = []
  for (const s of servers) {
    out.push(await runOnServer(s, command, hooks))
  }
  return out
}

/** Render batch output as a compact block the model can reason about. */
export function formatBatch(servers: FleetServer[], results: FleetRunOutcome[]): string {
  const lines: string[] = []
  for (const r of results) {
    if (r.type === 'ok') {
      lines.push(`### ${r.server} — exit ${r.exit_code} (${r.duration_ms}ms)`)
      if (r.stdout.trim()) lines.push(r.stdout.trim().slice(0, 4000))
      if (r.stderr.trim()) lines.push(`[stderr]\n${r.stderr.trim().slice(0, 1500)}`)
    } else if (r.type === 'approval_required') {
      lines.push(`### ${r.server} — needs approval (${r.risk})`)
      lines.push(`$ ${r.command}`)
    } else {
      lines.push(`### ${r.server} — error`)
      lines.push(r.message)
    }
  }
  const ok = results.filter((r) => r.type === 'ok').length
  lines.unshift(`${ok}/${servers.length} servers ran the command.`)
  return lines.join('\n')
}
