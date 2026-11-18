/**
 * Fleet mode: an Agent that is not bound to a single SSH session.
 *
 * It owns a *roster* of servers, each with its own login. On demand it opens a
 * short-lived sessiond session per server, runs one command, and closes it, so a
 * cluster task can touch many machines without leaving tabs behind. Credentials
 * entered in chat are handed straight to sessiond at connect time and never
 * written to hosts.json or the roster.
 */

export type FleetServer = {
  /** Stable id used in tool calls and logs. */
  id: string
  /** Human label, e.g. "k8s-master-1". */
  name: string
  host: string
  port: number
  user: string
  identity_file?: string
  use_agent?: boolean
  auth_method?: 'key' | 'password' | 'agent' | ''
  /** Group label for cluster operations, e.g. "prod-k8s". */
  group?: string
  /** Freeform role hint shown to the model, e.g. "control-plane". */
  role?: string
  tags?: string[]
  created_at: string
  updated_at: string
}

export type FleetServerInput = Omit<FleetServer, 'id' | 'created_at' | 'updated_at'>

export type FleetRunOutcome =
  | {
      type: 'ok'
      server: string
      command: string
      stdout: string
      stderr: string
      exit_code: number
      duration_ms: number
    }
  | { type: 'error'; server: string; command: string; message: string }
  | {
      type: 'approval_required'
      server: string
      command: string
      reason: string
      risk: 'low' | 'medium' | 'high'
    }

export type FleetBatchResult = {
  group: string
  results: FleetRunOutcome[]
  ok_count: number
  failed_count: number
}

/** Credentials collected from chat for one server. Never persisted. */
export type FleetCredential = {
  password?: string
  jump_password?: string
  jump_passwords?: Record<string, string>
}

export type FleetCredentialMap = Record<string, FleetCredential>
