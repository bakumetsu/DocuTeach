import type { Meta } from '../markdown/frontmatter'
import type { PageStyle } from './pageStyle'

export type SplitConfig = {
  lessonType: 'lesson' | 'exam'
  by: 'marker' | 'pages'
  ranges: string
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

const RANGES_FORMAT_ERROR = 'Enter page ranges like 1-10, 11-20'
const ORDER_ERROR = 'Ranges must go up and not overlap'
const START_AFTER_END_ERROR = 'Start must not be after end'

export function parsePageRanges(text: string): {
  ok: boolean
  ranges: [number, number][]
  error?: string
} {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, ranges: [], error: RANGES_FORMAT_ERROR }
  }

  const parts = trimmed.split(',').map((part) => part.trim())
  const ranges: [number, number][] = []

  for (const part of parts) {
    if (part === '') {
      return { ok: false, ranges: [], error: RANGES_FORMAT_ERROR }
    }

    const match = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/)
    if (!match) {
      return { ok: false, ranges: [], error: RANGES_FORMAT_ERROR }
    }

    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])

    if (start <= 0 || end <= 0) {
      return { ok: false, ranges: [], error: RANGES_FORMAT_ERROR }
    }

    if (start > end) {
      return { ok: false, ranges: [], error: START_AFTER_END_ERROR }
    }

    const previousEnd = ranges.length > 0 ? ranges[ranges.length - 1][1] : 0
    if (start <= previousEnd) {
      return { ok: false, ranges: [], error: ORDER_ERROR }
    }

    ranges.push([start, end])
  }

  return { ok: true, ranges }
}

export function pagesLeftOut(ranges: [number, number][], total: number): string {
  if (!Number.isFinite(total) || total <= 0) return ''

  const limit = Math.floor(total)
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const covered: [number, number][] = []

  for (const [rawStart, rawEnd] of sorted) {
    if (!isFiniteNumber(rawStart) || !isFiniteNumber(rawEnd)) continue

    const start = Math.max(1, Math.ceil(rawStart))
    const end = Math.min(limit, Math.floor(rawEnd))
    if (start > end) continue

    const last = covered[covered.length - 1]
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end)
    } else {
      covered.push([start, end])
    }
  }

  const missing: [number, number][] = []
  let cursor = 1

  for (const [start, end] of covered) {
    if (cursor < start) {
      missing.push([cursor, start - 1])
    }
    cursor = Math.max(cursor, end + 1)
    if (cursor > limit) break
  }

  if (cursor <= limit) {
    missing.push([cursor, limit])
  }

  return missing
    .map(([start, end]) => (start === end ? String(start) : `${start}-${end}`))
    .join(', ')
}

export function readSplit(meta: Meta): SplitConfig {
  const data = (meta.data ?? {}) as Record<string, unknown>
  const lessonType = data.lesson_type === 'exam' ? 'exam' : 'lesson'

  if (lessonType === 'exam') {
    return { lessonType: 'exam', by: 'marker', ranges: '' }
  }

  const rawSplit = data.split
  if (!rawSplit || typeof rawSplit !== 'object') {
    return { lessonType: 'lesson', by: 'marker', ranges: '' }
  }

  const split = rawSplit as Record<string, unknown>
  if (split.by !== 'pages') {
    return { lessonType: 'lesson', by: 'marker', ranges: '' }
  }

  const rawRanges = split.ranges
  if (!Array.isArray(rawRanges)) {
    return { lessonType: 'lesson', by: 'pages', ranges: '' }
  }

  const ranges: [number, number][] = []
  for (const item of rawRanges) {
    if (!Array.isArray(item) || item.length !== 2) continue
    if (!isFiniteNumber(item[0]) || !isFiniteNumber(item[1])) continue

    const start = Math.floor(item[0])
    const end = Math.floor(item[1])
    if (start < 1 || end < start) continue

    ranges.push([start, end])
  }

  const formatted = ranges
    .map(([start, end]) => (start === end ? String(start) : `${start}-${end}`))
    .join(', ')

  return { lessonType: 'lesson', by: 'pages', ranges: formatted }
}

export function splitToMeta(cfg: SplitConfig): Record<string, unknown> {
  if (cfg.lessonType === 'exam') {
    return {
      lesson_type: 'exam',
      split: { by: 'marker' },
    }
  }

  if (cfg.by === 'pages') {
    const parsed = parsePageRanges(cfg.ranges)
    return {
      lesson_type: 'lesson',
      split: {
        by: 'pages',
        ranges: parsed.ok ? parsed.ranges : [],
      },
    }
  }

  return {
    lesson_type: 'lesson',
    split: { by: 'marker' },
  }
}

export function fileList(cfg: SplitConfig): string[] {
  if (cfg.lessonType === 'exam') {
    return ['Student paper (PDF)', 'Teacher copy with answer key (DOCX)']
  }

  if (cfg.by === 'pages') {
    const parsed = parsePageRanges(cfg.ranges)
    const files = parsed.ok
      ? parsed.ranges.map(([start, end], index) => {
          const pages = start === end ? String(start) : `${start}-${end}`
          return `Part ${index + 1} (student PDF), pages ${pages}`
        })
      : []

    files.push('Teacher guide (DOCX)')
    return files
  }

  return [
    'Lesson (student PDF)',
    'Homework (student PDF)',
    'Teacher guide (DOCX)',
  ]
}

export function estimatePages(contentHeightPx: number, page: PageStyle): number {
  if (!Number.isFinite(contentHeightPx)) return 1

  const availableMm = 297 - page.margins[0] - page.margins[2]
  if (availableMm <= 0) return 1

  const pxPerPage = availableMm * 3.7795
  if (pxPerPage <= 0) return 1

  return Math.max(1, Math.ceil(contentHeightPx / pxPerPage))
}
