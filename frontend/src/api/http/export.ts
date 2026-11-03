import { request, requestBlob } from './client'
import type { DocuTeachApi, ExportPart, ExportWarning } from '../types'

export function parseContentDisposition(h: string | null): string | null {
  if (!h) return null
  const star = h.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // fall through to plain filename
    }
  }
  const plain = h.match(/filename\s*=\s*"([^"]*)"/i)
  if (plain) return plain[1]
  return null
}

export function parseWarnings(h: string | null): ExportWarning[] {
  if (!h) return []
  try {
    const decoded = decodeURIComponent(h)
    const arr = JSON.parse(decoded)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (w): w is ExportWarning => typeof w?.code === 'string' && typeof w?.message === 'string',
    )
  } catch {
    return []
  }
}

export const httpExports: DocuTeachApi['exports'] = {
  plan: (markdown, title) =>
    request<ExportPart[]>('POST', '/export/plan', { body: { markdown, title } }),
  download: async (markdown, title, target, part) => {
    const { blob, headers } = await requestBlob('POST', '/export', {
      markdown,
      title,
      target,
      part,
    })
    return {
      blob,
      filename: parseContentDisposition(headers.get('Content-Disposition')) ?? 'export',
      warnings: parseWarnings(headers.get('X-DocuTeach-Warnings')),
    }
  },
}
