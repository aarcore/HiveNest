import type { AgentEvent } from './events'
import type { AgentLoopCallbacks } from './types'

/** Map streamed events to legacy AgentPanel callbacks (optional dual wiring). */
export function applyAgentEventToCallbacks(ev: AgentEvent, cb: AgentLoopCallbacks): void {
  switch (ev.type) {
    case 'user':
      cb.onUserMessage?.(ev.text)
      break
    case 'assistant':
      cb.onAssistantMessage(ev.text)
      break
    case 'step':
      cb.onStep(ev.step, ev.label)
      break
    case 'tool_result':
      cb.onExecResult(ev.result)
      break
    case 'note':
      cb.onNote(ev.text)
      break
    case 'error':
      cb.onError(ev.message)
      break
    case 'done':
      cb.onDone()
      break
    case 'max_steps':
      cb.onMaxSteps()
      break
    default:
      break
  }
}
