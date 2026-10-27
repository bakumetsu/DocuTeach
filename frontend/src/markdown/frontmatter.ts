import { parse, Document, visit } from 'yaml'

export interface Meta {
  raw: string
  data: Record<string, unknown> | null
  broken: boolean
}

export const EMPTY_META: Meta = { raw: '', data: null, broken: false }

export function splitFrontMatter(
  text: string,
): { meta: Meta; body: string; warning?: string } {
  if (!text.startsWith('---\n')) {
    return { meta: EMPTY_META, body: text }
  }

  const lines = text.split('\n')
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      closeIdx = i
      break
    }
  }

  if (closeIdx === -1) {
    return { meta: EMPTY_META, body: text }
  }

  const raw = lines.slice(1, closeIdx).join('\n')

  let bodyLines = lines.slice(closeIdx + 1)
  if (bodyLines.length > 0 && bodyLines[0] === '') {
    bodyLines = bodyLines.slice(1)
  }
  const body = bodyLines.join('\n')

  let data: Record<string, unknown> | null
  let broken = false
  let warning: string | undefined

  if (raw === '') {
    data = {}
  } else {
    try {
      const parsed = parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>
      } else {
        broken = true
        data = null
        warning = 'Front matter is not valid YAML; kept as written'
      }
    } catch {
      broken = true
      data = null
      warning = 'Front matter is not valid YAML; kept as written'
    }
  }

  return { meta: { raw, data, broken }, body, ...(warning !== undefined ? { warning } : {}) }
}

export function serializeFrontMatter(meta: Meta): string {
  if (meta.raw === '' && meta.data === null && !meta.broken) {
    return ''
  }
  return '---\n' + meta.raw + '\n---\n\n'
}

export function updateMeta(meta: Meta, patch: Record<string, unknown>): Meta {
  if (meta.broken) return meta

  const newData: Record<string, unknown> = { ...(meta.data ?? {}) }
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) {
      delete newData[key]
    } else {
      newData[key] = patch[key]
    }
  }

  const doc = new Document(newData)

  // Set flow = true on every Map/Seq below the root (the root itself stays block)
  visit(doc, {
    Map(_key, node) {
      if (node !== doc.contents) node.flow = true
    },
    Seq(_key, node) {
      node.flow = true
    },
  })

  const raw = doc.toString({ flowCollectionPadding: false }).replace(/\n$/, '')

  return { raw, data: newData, broken: false }
}
