import type { Meta } from '../markdown/frontmatter'

export interface PageStyle {
  font: string
  size: number
  line: number
  margins: [number, number, number, number]
}

export const DEFAULT_PAGE: PageStyle = {
  font: 'Arial',
  size: 12,
  line: 1.65,
  margins: [12, 15, 12, 15],
}

const SERIF_FONTS = new Set(['times new roman', 'cambria'])

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function readPageStyle(meta: Meta): PageStyle {
  const page = meta.data?.page as Record<string, unknown> | undefined
  if (!page || typeof page !== 'object') return { ...DEFAULT_PAGE, margins: [...DEFAULT_PAGE.margins] }

  const font =
    typeof page.font === 'string' && page.font.length > 0
      ? page.font
      : DEFAULT_PAGE.font

  const size =
    isFiniteNumber(page.size) && page.size >= 8 && page.size <= 24
      ? page.size
      : DEFAULT_PAGE.size

  const line =
    isFiniteNumber(page.line) && page.line >= 1 && page.line <= 3
      ? page.line
      : DEFAULT_PAGE.line

  const rawMargins = page.margins_mm
  let margins: [number, number, number, number] = [...DEFAULT_PAGE.margins]
  if (
    Array.isArray(rawMargins) &&
    rawMargins.length === 4 &&
    rawMargins.every((m) => isFiniteNumber(m) && m >= 0 && m <= 60)
  ) {
    margins = rawMargins as [number, number, number, number]
  }

  return { font, size, line, margins }
}

export function pageStyleToMeta(s: PageStyle): Record<string, unknown> {
  return {
    font: s.font,
    size: s.size,
    line: s.line,
    margins_mm: [...s.margins],
  }
}

export function pageCssVars(s: PageStyle): Record<string, string> {
  const lower = s.font.toLowerCase()
  const stack = SERIF_FONTS.has(lower)
    ? `"${s.font}", "Noto Serif", Georgia, serif`
    : `"${s.font}", "Noto Sans", "Noto Serif", Arial, sans-serif`

  return {
    '--page-font': stack,
    '--page-size': String(s.size),
    '--page-line': String(s.line),
    '--page-mt': `${s.margins[0]}mm`,
    '--page-mr': `${s.margins[1]}mm`,
    '--page-mb': `${s.margins[2]}mm`,
    '--page-ml': `${s.margins[3]}mm`,
  }
}
