import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAGE,
  readPageStyle,
  pageStyleToMeta,
  pageCssVars,
} from '../src/editor/pageStyle'
import type { Meta } from '../src/markdown/frontmatter'

function metaWith(page: unknown): Meta {
  return { raw: '', data: page === undefined ? null : { page }, broken: false }
}

describe('readPageStyle', () => {
  it('returns defaults when meta is empty', () => {
    const result = readPageStyle(metaWith(undefined))
    expect(result).toEqual(DEFAULT_PAGE)
  })

  it('returns defaults when meta.data is null', () => {
    const result = readPageStyle({ raw: '', data: null, broken: false })
    expect(result).toEqual(DEFAULT_PAGE)
  })

  it('reads a valid page object', () => {
    const page = { font: 'Georgia', size: 14, line: 1.8, margins_mm: [10, 20, 10, 20] }
    const result = readPageStyle(metaWith(page))
    expect(result).toEqual({ font: 'Georgia', size: 14, line: 1.8, margins: [10, 20, 10, 20] })
  })

  it('falls back individually for invalid font', () => {
    const page = { font: 42, size: 14, line: 1.8, margins_mm: [10, 20, 10, 20] }
    const result = readPageStyle(metaWith(page))
    expect(result.font).toBe(DEFAULT_PAGE.font)
    expect(result.size).toBe(14)
  })

  it('falls back for size out of range', () => {
    const page = { font: 'Arial', size: 50, line: 1.5, margins_mm: [10, 20, 10, 20] }
    const result = readPageStyle(metaWith(page))
    expect(result.size).toBe(DEFAULT_PAGE.size)
  })

  it('falls back for line out of range', () => {
    const page = { font: 'Arial', size: 12, line: 5, margins_mm: [10, 20, 10, 20] }
    const result = readPageStyle(metaWith(page))
    expect(result.line).toBe(DEFAULT_PAGE.line)
  })

  it('falls back for margins with wrong length', () => {
    const page = { font: 'Arial', size: 12, line: 1.5, margins_mm: [10, 20, 10] }
    const result = readPageStyle(metaWith(page))
    expect(result.margins).toEqual(DEFAULT_PAGE.margins)
  })

  it('falls back for margin value out of range', () => {
    const page = { font: 'Arial', size: 12, line: 1.5, margins_mm: [10, 200, 10, 20] }
    const result = readPageStyle(metaWith(page))
    expect(result.margins).toEqual(DEFAULT_PAGE.margins)
  })

  it('falls back for non-numeric margin', () => {
    const page = { font: 'Arial', size: 12, line: 1.5, margins_mm: [10, 'a', 10, 20] }
    const result = readPageStyle(metaWith(page))
    expect(result.margins).toEqual(DEFAULT_PAGE.margins)
  })
})

describe('pageStyleToMeta / readPageStyle round-trip', () => {
  it('round-trips a custom style', () => {
    const style = { font: 'Cambria', size: 13, line: 1.4, margins: [8, 25, 8, 25] as [number, number, number, number] }
    const metaObj = pageStyleToMeta(style)
    expect(metaObj).toEqual({
      font: 'Cambria',
      size: 13,
      line: 1.4,
      margins_mm: [8, 25, 8, 25],
    })
    const meta: Meta = { raw: '', data: { page: metaObj }, broken: false }
    expect(readPageStyle(meta)).toEqual(style)
  })
})

describe('pageCssVars', () => {
  it('produces correct vars for Arial (sans)', () => {
    const vars = pageCssVars(DEFAULT_PAGE)
    expect(vars['--page-font']).toBe('"Arial", "Noto Sans", "Noto Serif", Arial, sans-serif')
    expect(vars['--page-size']).toBe('12')
    expect(vars['--page-line']).toBe('1.65')
    expect(vars['--page-mt']).toBe('12mm')
    expect(vars['--page-mr']).toBe('15mm')
    expect(vars['--page-mb']).toBe('12mm')
    expect(vars['--page-ml']).toBe('15mm')
  })

  it('produces correct vars for Times New Roman (serif)', () => {
    const style = { font: 'Times New Roman', size: 11, line: 1.5, margins: [20, 25, 20, 25] as [number, number, number, number] }
    const vars = pageCssVars(style)
    expect(vars['--page-font']).toBe('"Times New Roman", "Noto Serif", Georgia, serif')
    expect(vars['--page-size']).toBe('11')
    expect(vars['--page-line']).toBe('1.5')
    expect(vars['--page-mt']).toBe('20mm')
    expect(vars['--page-mr']).toBe('25mm')
    expect(vars['--page-mb']).toBe('20mm')
    expect(vars['--page-ml']).toBe('25mm')
  })
})
