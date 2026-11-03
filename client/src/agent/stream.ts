/**
 * Convenience helpers for consuming agent event streams (Claude Agent SDK–style).
 *
 * @example
 * for await (const ev of streamAgentUserTurn(ctx, state, prompt)) {
 *   if (ev.type === 'assistant') console.log(ev.text)
 * }
 */

export { streamAgentUserTurn, streamAgentToolLoop, streamAgentResume } from './toolLoop'
export type { AgentEvent } from './events'
export { applyAgentEventToCallbacks } from './streamUi'
export type { AgentEventSink } from './toolLoop'
