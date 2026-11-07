import { describe, it, expect } from 'vitest'
import {
  splitFrontMatter,
  serializeFrontMatter,
  updateMeta,
  EMPTY_META,
  type Meta,
} from '../src/markdown/frontmatter'

describe('splitFrontMatter', () => {
  it('parses the design example front matter', () => {
    const text = [
      '---',
      'lesson_type: lesson',
      'split: {by: marker}',
      'page: {font: Arial, size: 12, line: 1.65, margins_mm: [12, 15, 12, 15]}',
      '---',
      '',
      '# Title',
    ].join('\n')

    const { meta, body, warning } = splitFrontMatter(text)
    expect(warning).toBeUndefined()
    expect(meta.broken).toBe(false)
    expect(meta.data).toEqual({
      lesson_type: 'lesson',
      split: { by: 'marker' },
      page: { font: 'Arial', size: 12, line: 1.65, margins_mm: [12, 15, 12, 15] },
    })
    expect(meta.raw).toBe(
      'lesson_type: lesson\nsplit: {by: marker}\npage: {font: Arial, size: 12, line: 1.65, margins_mm: [12, 15, 12, 15]}',
    )
    expect(body).toBe('# Title')
  })

  it('returns EMPTY_META and unchanged body when no front matter', () => {
    const text = '# Hello\n\nWorld'
    const { meta, body } = splitFrontMatter(text)
    expect(meta).toBe(EMPTY_META)
    expect(body).toBe('# Hello\n\nWorld')
  })

  it('handles broken YAML (unclosed bracket)', () => {
    const text = '---\nlesson_type: [unclosed\n---\n\nBody'
    const { meta, body, warning } = splitFrontMatter(text)
    expect(meta.broken).toBe(true)
    expect(meta.data).toBeNull()
    expect(meta.raw).toBe('lesson_type: [unclosed')
    expect(warning).toBe('Front matter is not valid YAML; kept as written')
    expect(body).toBe('Body')
  })

  it('treats empty raw as data {}', () => {
    const text = '---\n---\n\nBody'
    const { meta, body } = splitFrontMatter(text)
    expect(meta.broken).toBe(false)
    expect(meta.data).toEqual({})
    expect(meta.raw).toBe('')
    expect(body).toBe('Body')
  })

  it('removes one blank line after closing fence', () => {
    const text = '---\nkey: val\n---\n\nFirst line'
    const { body } = splitFrontMatter(text)
    expect(body).toBe('First line')
  })

  it('does not remove body content if no blank line after fence', () => {
    const text = '---\nkey: val\n---\nFirst line'
    const { body } = splitFrontMatter(text)
    expect(body).toBe('First line')
  })

  it('returns text unchanged when opening fence has no closing fence', () => {
    const text = '---\nkey: val\nno closing fence'
    const { meta, body } = splitFrontMatter(text)
    expect(meta).toBe(EMPTY_META)
    expect(body).toBe(text)
  })

  it('handles scalar YAML result as broken', () => {
    const text = '---\njust a string\n---\n\nBody'
    const { meta, warning } = splitFrontMatter(text)
    expect(meta.broken).toBe(true)
    expect(meta.data).toBeNull()
    expect(warning).toBe('Front matter is not valid YAML; kept as written')
  })
})

describe('serializeFrontMatter', () => {
  it('returns empty string for EMPTY_META', () => {
    expect(serializeFrontMatter(EMPTY_META)).toBe('')
  })

  it('serializes a meta with raw', () => {
    const meta: Meta = { raw: 'key: val', data: { key: 'val' }, broken: false }
    expect(serializeFrontMatter(meta)).toBe('---\nkey: val\n---\n\n')
  })

  it('serializes broken meta verbatim', () => {
    const meta: Meta = { raw: 'bad: [yaml', data: null, broken: true }
    expect(serializeFrontMatter(meta)).toBe('---\nbad: [yaml\n---\n\n')
  })
})

describe('updateMeta', () => {
  it('merges patch into existing data keeping key order', () => {
    const meta: Meta = {
      raw: 'a: 1\nb: 2',
      data: { a: 1, b: 2 },
      broken: false,
    }
    const result = updateMeta(meta, { c: 3 })
    expect(result.data).toEqual({ a: 1, b: 2, c: 3 })
    expect(result.broken).toBe(false)
    expect(result.raw).toContain('a: 1')
    expect(result.raw).toContain('b: 2')
    expect(result.raw).toContain('c: 3')
  })

  it('deletes a key when patch value is undefined', () => {
    const meta: Meta = {
      raw: 'a: 1\nb: 2',
      data: { a: 1, b: 2 },
      broken: false,
    }
    const result = updateMeta(meta, { b: undefined })
    expect(result.data).toEqual({ a: 1 })
    expect(result.raw).not.toContain('b:')
  })

  it('returns meta unchanged when broken', () => {
    const meta: Meta = { raw: 'bad', data: null, broken: true }
    const result = updateMeta(meta, { a: 1 })
    expect(result).toBe(meta)
  })

  it('writes page object with flowLevel 1 inline style', () => {
    const meta: Meta = { raw: '', data: {}, broken: false }
    const result = updateMeta(meta, {
      page: { font: 'Arial', size: 12, line: 1.65, margins_mm: [12, 15, 12, 15] },
    })
    expect(result.raw).toContain('page: {font: Arial')
    expect(result.raw).toContain('margins_mm: [12, 15, 12, 15]')
    expect(result.raw.endsWith('\n')).toBe(false)
  })
})
