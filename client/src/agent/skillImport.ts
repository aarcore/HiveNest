/** Import Agent skills from .md files or a .zip of markdown skills. */

import { parseSkillMarkdown, type CustomSkill } from './skills'

export type ImportedSkillFile = {
  filename: string
  skill: CustomSkill
}

function basename(path: string): string {
  const p = path.replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function isSkillMarkdownPath(path: string): boolean {
  const n = path.replace(/\\/g, '/').toLowerCase()
  if (n.includes('__macosx/') || n.startsWith('.')) return false
  if (n.endsWith('/skill.md') || n === 'skill.md') return true
  return n.endsWith('.md')
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('ZIP deflate is not supported in this runtime; upload .md files instead')
  }
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

function u16(view: DataView, off: number) {
  return view.getUint16(off, true)
}
function u32(view: DataView, off: number) {
  return view.getUint32(off, true)
}

/** Minimal ZIP reader (store + deflate) for skill markdown packs. */
export async function extractMarkdownFromZip(buf: ArrayBuffer): Promise<{ path: string; text: string }[]> {
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  if (bytes.length < 22) throw new Error('ZIP file is too small')

  // Find EOCD
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 0x10000; i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP (EOCD not found)')

  const count = u16(view, eocd + 10)
  let offset = u32(view, eocd + 16)
  const out: { path: string; text: string }[] = []

  for (let n = 0; n < count; n++) {
    if (u32(view, offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory')
    const method = u16(view, offset + 10)
    const compSize = u32(view, offset + 20)
    const nameLen = u16(view, offset + 28)
    const extraLen = u16(view, offset + 30)
    const commentLen = u16(view, offset + 32)
    const localOff = u32(view, offset + 42)
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLen)
    const path = new TextDecoder('utf-8').decode(nameBytes)
    offset += 46 + nameLen + extraLen + commentLen

    if (path.endsWith('/')) continue
    if (!isSkillMarkdownPath(path)) continue

    if (u32(view, localOff) !== 0x04034b50) throw new Error(`Invalid local header for ${path}`)
    const lNameLen = u16(view, localOff + 26)
    const lExtraLen = u16(view, localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const comp = bytes.slice(dataStart, dataStart + compSize)

    let raw: Uint8Array
    if (method === 0) raw = comp
    else if (method === 8) raw = await inflateRaw(comp)
    else throw new Error(`Unsupported ZIP compression method ${method} for ${path}`)

    const text = new TextDecoder('utf-8').decode(raw)
    out.push({ path, text })
  }

  if (!out.length) throw new Error('ZIP contains no .md / SKILL.md skill files')
  return out
}

export async function importSkillsFromFile(file: File): Promise<ImportedSkillFile[]> {
  const name = file.name || 'skill.md'
  const lower = name.toLowerCase()

  if (lower.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
    const entries = await extractMarkdownFromZip(await file.arrayBuffer())
    return entries.map((e) => {
      const base = basename(e.path).replace(/\.md$/i, '') || 'skill'
      const skill = parseSkillMarkdown(e.text, base)
      // Prefer folder name when file is SKILL.md inside a directory
      const parts = e.path.replace(/\\/g, '/').split('/')
      if (parts.length >= 2 && parts[parts.length - 1].toLowerCase() === 'skill.md') {
        const folder = parts[parts.length - 2]
        if (folder && !skill.id) {
          /* parseSkillMarkdown always sets id */
        }
        if (/^[a-z][a-z0-9-]{1,62}$/i.test(folder) && !e.text.startsWith('---')) {
          skill.id = folder.toLowerCase()
        }
      }
      return { filename: e.path, skill }
    })
  }

  if (!lower.endsWith('.md') && file.type && !file.type.includes('markdown') && !file.type.includes('text')) {
    throw new Error('Upload a .md skill file or a .zip of skills')
  }

  const text = await file.text()
  const skill = parseSkillMarkdown(text, basename(name).replace(/\.md$/i, '') || 'uploaded-skill')
  return [{ filename: name, skill }]
}
