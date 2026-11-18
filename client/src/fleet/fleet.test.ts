import { describe, expect, it } from 'vitest'
import { parseFleetReply } from './agent'
import { scrubSecrets } from './roster'

describe('fleet reply parsing', () => {
  it('reads a run action', () => {
    const { action } = parseFleetReply(
      '{"action":"run","target":"prod-k8s","command":"kubectl get nodes","reason":"check","reply":"Checking nodes."}',
    )
    expect(action).toEqual({
      kind: 'run',
      target: 'prod-k8s',
      command: 'kubectl get nodes',
      reason: 'check',
    })
  })

  it('shows the reply, never raw JSON', () => {
    const run = parseFleetReply(
      '{"action":"run","target":"all","command":"uptime","reply":"Checking uptime."}',
    )
    expect(run.text).toBe('Checking uptime.')
    expect(run.text).not.toContain('{')

    const list = parseFleetReply('{"action":"list","reply":"Here is the roster."}')
    expect(list.text).toBe('Here is the roster.')
    expect(list.text).not.toContain('"action"')
  })

  it('falls back to a readable line when the model omits reply', () => {
    const run = parseFleetReply('{"action":"run","command":"uptime"}')
    expect(run.text).toBe('Running on every server.')
    const list = parseFleetReply('{"action":"list"}')
    expect(list.text).toBe('Reading the server roster.')
    expect(list.text).not.toContain('{')
  })

  it('defaults target to all and tolerates a code fence', () => {
    const { action } = parseFleetReply(
      '```json\n{"action":"run","command":"uptime","reply":"ok"}\n```',
    )
    expect(action.kind).toBe('run')
    if (action.kind === 'run') expect(action.target).toBe('all')
  })

  it('captures a password without leaving it in the visible text', () => {
    const { action, secrets, text } = parseFleetReply(
      '{"action":"register","name":"db-01","host":"10.0.0.21","user":"root","auth":"password","password":"s3cret","reply":"Added db-01."}',
    )
    expect(secrets).toEqual(['s3cret'])
    expect(text).toBe('Added db-01.')
    expect(text).not.toContain('s3cret')
    expect(action.kind).toBe('register')
  })

  it('keeps register fields and defaults the port', () => {
    const { action } = parseFleetReply(
      '{"action":"register","name":"w1","host":"10.0.0.31","user":"ubuntu","group":"prod-k8s","role":"worker"}',
    )
    if (action.kind !== 'register') throw new Error('expected register')
    expect(action.server.port).toBe(22)
    expect(action.server.group).toBe('prod-k8s')
    expect(action.server.role).toBe('worker')
  })

  it('falls back to done when the reply is not JSON', () => {
    const { action } = parseFleetReply('All done, cluster is healthy.')
    expect(action.kind).toBe('done')
    if (action.kind === 'done') expect(action.reply).toContain('cluster is healthy')
  })

  it('recognises list and remember', () => {
    expect(parseFleetReply('{"action":"list"}').action.kind).toBe('list')
    const remember = parseFleetReply('{"action":"remember","target":"db-01","password":"pw"}')
    expect(remember.action.kind).toBe('remember')
    expect(remember.secrets).toEqual(['pw'])
  })
})

describe('scrubSecrets', () => {
  it('masks every occurrence of a known secret', () => {
    const out = scrubSecrets('login with pw123 then pw123 again', ['pw123'])
    expect(out).not.toContain('pw123')
    expect(out.match(/••••••/g)).toHaveLength(2)
  })

  it('leaves text alone when there is nothing to hide', () => {
    expect(scrubSecrets('kubectl get nodes', [])).toBe('kubectl get nodes')
  })

  it('ignores very short values so normal words are not mangled', () => {
    expect(scrubSecrets('the pod is up', ['up'])).toBe('the pod is up')
  })
})
