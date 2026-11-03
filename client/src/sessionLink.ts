import { execCommand, getSession, type ApiError } from './api'

export type SessionLinkStatus = 'ok' | 'missing' | 'dead'

/** Lightweight link check: session exists on sessiond and SSH/local exec still works. */
export async function checkSessionLink(sessionId: string): Promise<SessionLinkStatus> {
  try {
    await getSession(sessionId)
  } catch (ex) {
    const err = ex as ApiError
    if (err.status === 404) return 'missing'
    return 'dead'
  }
  try {
    await execCommand(sessionId, { command: 'true', actor: 'agent' })
    return 'ok'
  } catch {
    return 'dead'
  }
}
