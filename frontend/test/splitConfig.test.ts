import { describe, expect, it } from 'vitest'

import {
  estimatePages,
  fileList,
  pagesLeftOut,
  parsePageRanges,
  readSplit,
  splitToMeta,
} from '../src/editor/splitConfig'
import type { PageStyle } from '../src/editor/pageStyle'
import type { Meta } from '../src/markdown/frontmatter'

function metaWith(data: Record<string, unknown>): Meta {
  return { data } as unknown as Meta
}

describe('parsePageRanges', () => {
  it('accepts valid ascending ranges', () => {
    expect(parsePageRanges('1-10, 11-20')).toEqual({
      ok: true,
      ranges: [
        [1, 10],
        [11, 20],
      ],
    })
  })

  it('accepts a single page', () => {
    expect(parsePageRanges('5')).toEqual({
      ok: true,
      ranges: [[5, 5]],
    })
  })

  it('allows spaces around values and separators', () => {
    expect(parsePageRanges(' 1 - 10 , 11 - 20 ')).toEqual({
      ok: true,
      ranges: [
        [1, 10],
        [11, 20],
      ],
    })
  })

  it('rejects descending range items', () => {
    expect(parsePageRanges('5-3')).toEqual({
      ok: false,
      ranges: [],
      error: 'Start must not be after end',
    })
  })

  it('rejects ranges that are out of order', () => {
    expect(parsePageRanges('11-20, 1-10')).toEqual({
      ok: false,
      ranges: [],
      error: 'Ranges must go up and not overlap',
    })
  })

  it('rejects overlapping ranges', () => {
    expect(parsePageRanges('1-10, 10-20')).toEqual({
      ok: false,
      ranges: [],
      error: 'Ranges must go up and not overlap',
    })
  })

  it('rejects garbage input', () => {
    expect(parsePageRanges('abc')).toEqual({
      ok: false,
      ranges: [],
      error: 'Enter page ranges like 1-10, 11-20',
    })
  })

  it('rejects empty input', () => {
    expect(parsePageRanges('')).toEqual({
      ok: false,
      ranges: [],
      error: 'Enter page ranges like 1-10, 11-20',
    })
  })

  it('rejects zero pages', () => {
    expect(parsePageRanges('0')).toEqual({
      ok: false,
      ranges: [],
      error: 'Enter page ranges like 1-10, 11-20',
    })
  })
})

describe('pagesLeftOut', () => {
  it('returns empty string when all pages are covered', () => {
    expect(pagesLeftOut([[1, 5]], 5)).toBe('')
  })

  it('reports gaps and trailing pages', () => {
    expect(pagesLeftOut([[1, 10], [12, 20]], 25)).toBe('11, 21-25')
  })

  it('reports all pages when no ranges are provided', () => {
    expect(pagesLeftOut([], 3)).toBe('1-3')
  })

  it('handles unsorted ranges', () => {
    expect(pagesLeftOut([[10, 20], [1, 5]], 25)).toBe('6-9, 21-25')
  })
})

describe('readSplit and splitToMeta', () => {
  it('defaults to lesson marker', () => {
    expect(readSplit(metaWith({}))).toEqual({
      lessonType: 'lesson',
      by: 'marker',
      ranges: '',
    })
  })

  it('round-trips lesson marker config', () => {
    const cfg = readSplit(metaWith({ lesson_type: 'lesson', split: { by: 'marker' } }))
    expect(cfg).toEqual({ lessonType: 'lesson', by: 'marker', ranges: '' })
    expect(splitToMeta(cfg)).toEqual({
      lesson_type: 'lesson',
      split: { by: 'marker' },
    })
  })

  it('round-trips lesson pages config', () => {
    const meta = metaWith({
      lesson_type: 'lesson',
      split: { by: 'pages', ranges: [[1, 10], [11, 20]] },
    })

    const cfg = readSplit(meta)
    expect(cfg).toEqual({
      lessonType: 'lesson',
      by: 'pages',
      ranges: '1-10, 11-20',
    })

    expect(splitToMeta(cfg)).toEqual({
      lesson_type: 'lesson',
      split: { by: 'pages', ranges: [[1, 10], [11, 20]] },
    })
  })

  it('forces exam to marker', () => {
    const cfg = readSplit(
      metaWith({ lesson_type: 'exam', split: { by: 'pages', ranges: [[1, 10]] } }),
    )

    expect(cfg).toEqual({ lessonType: 'exam', by: 'marker', ranges: '' })
    expect(splitToMeta(cfg)).toEqual({
      lesson_type: 'exam',
      split: { by: 'marker' },
    })
  })
})

describe('fileList', () => {
  it('returns lesson marker files', () => {
    expect(fileList({ lessonType: 'lesson', by: 'marker', ranges: '' })).toEqual([
      'Lesson (student PDF)',
      'Homework (student PDF)',
      'Teacher guide (DOCX)',
    ])
  })

  it('returns lesson page range files', () => {
    expect(fileList({ lessonType: 'lesson', by: 'pages', ranges: '1-3, 5-7' })).toEqual([
      'Part 1 (student PDF), pages 1-3',
      'Part 2 (student PDF), pages 5-7',
      'Teacher guide (DOCX)',
    ])
  })

  it('returns exam files', () => {
    expect(fileList({ lessonType: 'exam', by: 'marker', ranges: '' })).toEqual([
      'Student paper (PDF)',
      'Teacher copy with answer key (DOCX)',
    ])
  })
})

describe('estimatePages', () => {
  const page: PageStyle = {
    font: 'Arial',
    size: 12,
    line: 1.65,
    margins: [0, 0, 0, 0],
  }

  it('estimates one page for small content', () => {
    expect(estimatePages(1000, page)).toBe(1)
  })

  it('estimates multiple pages for taller content', () => {
    expect(estimatePages(2300, page)).toBe(3)
  })

  it('returns at least one page for zero height', () => {
    expect(estimatePages(0, page)).toBe(1)
  })

  it('returns at least one page for negative height', () => {
    expect(estimatePages(-100, page)).toBe(1)
  })
})
