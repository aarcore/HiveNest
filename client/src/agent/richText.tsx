/**
 * Minimal Markdown for Agent chat bubbles.
 *
 * Models write short answers with light formatting: bold, inline code, fenced
 * code, bullet lists, and paragraphs. This renders exactly that set and nothing
 * more — no HTML passthrough, no links with custom schemes — so a model reply
 * can never inject markup. Everything is escaped before it is wrapped.
 */

import type { ReactNode } from 'react'

/** Escape the characters that would otherwise be read as markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline formatting applied to already-escaped text. */
function inline(escaped: string): string {
  return escaped
    // `code` first so ** inside code is not turned bold
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '<em>$1</em>')
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }

/** Split a table row into cells, tolerating leading/trailing pipes. */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/** `|---|:--:|---|` — at least one dash per column, separators only. */
function isTableDivider(line: string): boolean {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c))
}

function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // fenced code
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      const lang = fence[1] || ''
      i += 1
      const body: string[] = []
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // closing fence (tolerates a truncated reply)
      out.push({ kind: 'code', lang, text: body.join('\n') })
      continue
    }

    // heading
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/)
    if (heading) {
      out.push({ kind: 'h', level: heading[1].length, text: heading[2].trim() })
      i += 1
      continue
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '').trim())
        i += 1
      }
      out.push({ kind: 'ul', items })
      continue
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim())
        i += 1
      }
      out.push({ kind: 'ol', items })
      continue
    }

    // table: a header row followed by a divider row
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = tableCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(tableCells(lines[i]))
        i += 1
      }
      out.push({ kind: 'table', head, rows })
      continue
    }

    // blank line
    if (!line.trim()) {
      i += 1
      continue
    }

    // paragraph: consume until a blank line or the start of another block
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !(
        lines[i].includes('|') &&
        i + 1 < lines.length &&
        isTableDivider(lines[i + 1])
      )
    ) {
      para.push(lines[i].trim())
      i += 1
    }
    out.push({ kind: 'p', text: para.join(' ') })
  }

  return out
}

/**
 * Render a Markdown-ish string to React nodes.
 *
 * Falsy or whitespace-only input returns null so callers can skip the bubble
 * entirely rather than showing an empty box.
 */
export function renderRichText(src: string | undefined | null): ReactNode | null {
  const text = (src ?? '').trim()
  if (!text) return null

  const blocks = splitBlocks(text)
  if (!blocks.length) return null

  return blocks.map((b, i) => {
    switch (b.kind) {
      case 'code':
        return (
          <pre key={i} className="rich-code">
            <code dangerouslySetInnerHTML={{ __html: escapeHtml(b.text) }} />
          </pre>
        )
      case 'h': {
        // Keep the visual hierarchy small: bubbles are narrow.
        const cls = b.level <= 2 ? 'rich-h rich-h1' : 'rich-h rich-h2'
        return (
          <p key={i} className={cls} dangerouslySetInnerHTML={{ __html: inline(escapeHtml(b.text)) }} />
        )
      }
      case 'ul':
        return (
          <ul key={i} className="rich-list">
            {b.items.map((it, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: inline(escapeHtml(it)) }} />
            ))}
          </ul>
        )
      case 'ol':
        return (
          <ol key={i} className="rich-list">
            {b.items.map((it, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: inline(escapeHtml(it)) }} />
            ))}
          </ol>
        )
      case 'table':
        return (
          <div key={i} className="rich-table-wrap">
            <table className="rich-table">
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} dangerouslySetInnerHTML={{ __html: inline(escapeHtml(c)) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {b.head.map((_, c) => (
                      <td
                        key={c}
                        dangerouslySetInnerHTML={{ __html: inline(escapeHtml(row[c] ?? '')) }}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      default:
        return (
          <p key={i} className="rich-p" dangerouslySetInnerHTML={{ __html: inline(escapeHtml(b.text)) }} />
        )
    }
  })
}

/**
 * Strip action JSON that leaked into a model message before rendering.
 *
 * A reply sometimes ends with the control object the loop consumes. Showing it
 * to the user is noise at best and leaks the protocol at worst, so drop any
 * trailing fenced or bare object and keep the prose.
 */
export function stripActionJson(text: string): string {
  let out = text.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/gi, '')
  // Bare object at the end that looks like our control shape.
  out = out.replace(/\{\s*"(?:action|command|tool|mcp|done|reply)"\s*:[\s\S]*\}\s*$/i, '')
  // A lone fenced block wrapper left behind.
  out = out.replace(/^```\w*\s*$/gm, '')
  return out.trim()
}
