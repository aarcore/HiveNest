import type { ExecResult, Proposal } from '../api'

/** Streamed agent events (Claude Agent SDK–style message stream). */
export type AgentEvent =
  | { type: 'turn_start'; prompt?: string }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'model_request' }
  | { type: 'model_response'; mode: 'json_protocol' | 'anthropic_tools' }
  | { type: 'step'; step: number; label: string }
  | { type: 'tool_exec_start'; label: string }
  | { type: 'tool_result'; result: ExecResult }
  | { type: 'note'; text: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'done' }
  | { type: 'max_steps' }
  | { type: 'error'; message: string }
  | { type: 'turn_end'; phase: 'completed' | 'stopped' | 'awaiting_permission' | 'error' }
