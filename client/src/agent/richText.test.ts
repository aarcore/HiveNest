import { describe, expect, it } from 'vitest'
import { renderRichText, stripActionJson } from './richText'

describe('stripActionJson', () => {
  it('removes a trailing fenced JSON block and keeps the prose', () => {
    const input = `nginx is running.

\`\`\`json
{"command":"systemctl is-active nginx","reason":"check","reply":"nginx is active.","done":false}
\`\`\``
    const out = stripActionJson(input)
    expect(out).toContain('nginx is running.')
    expect(out).not.toContain('systemctl')
    expect(out).not.toContain('{')
  })

  it('removes a bare trailing control object', () => {
    const out = stripActionJson('Disk is 22% used.\n{"command":"df -h","done":false}')
    expect(out).toBe('Disk is 22% used.')
  })

  it('leaves ordinary prose untouched', () => {
    const text = 'The service is healthy. Nothing else ran.'
    expect(stripActionJson(text)).toBe(text)
  })

  it('keeps JSON that is part of an answer rather than a control object', () => {
    const text = 'The config looks like {"port": 5432} in the file.'
    expect(stripActionJson(text)).toContain('"port": 5432')
  })

  it('returns empty for a reply that was only the control object', () => {
    expect(stripActionJson('{"command":"uptime","done":false}')).toBe('')
  })
})

describe('renderRichText', () => {
  it('returns null for empty input', () => {
    expect(renderRichText('')).toBeNull()
    expect(renderRichText('   \n  ')).toBeNull()
    expect(renderRichText(null)).toBeNull()
  })

  it('renders a markdown table as a table block', () => {
    const nodes = renderRichText(`| 指标 | 前 | 后 |
|---|---|---|
| 已用 | 62G | 11G |`) as unknown as { type: unknown; props: Record<string, unknown> }[]
    expect(Array.isArray(nodes)).toBe(true)
    const wrap = nodes.find((n) => (n.props as { className?: string }).className === 'rich-table-wrap')
    expect(wrap, 'table wrapper').toBeTruthy()
  })

  it('does not treat a divider-only line as a table', () => {
    const nodes = renderRichText('|---|---|') as unknown as { props: Record<string, unknown> }[]
    const classes = nodes.map((n) => (n.props as { className?: string }).className)
    expect(classes).not.toContain('rich-table-wrap')
  })

  it('escapes html in the reply', () => {
    const nodes = JSON.stringify(renderRichText('<script>alert(1)</script>'))
    expect(nodes).not.toContain('<script>')
    expect(nodes).toContain('&lt;script&gt;')
  })

  it('renders bullets and paragraphs separately', () => {
    const nodes = renderRichText('Intro line.\n\n- one\n- two') as unknown as {
      props: { className?: string }
    }[]
    const classes = nodes.map((n) => n.props.className)
    expect(classes).toContain('rich-p')
    expect(classes).toContain('rich-list')
  })
})
