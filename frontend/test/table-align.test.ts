import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../src/markdown/parse'
import { serializeMarkdown } from '../src/markdown/serialize'

const ALIGNED = '| a | b | c | d |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n'

describe('table alignment', () => {
  it('parses separator colons into cell attrs', () => {
    const doc = parseMarkdown(ALIGNED).doc
    const row = doc.child(0).child(1)
    const got: unknown[] = []
    row.forEach((c) => got.push(c.attrs.textAlign))
    expect(got).toEqual(['left', 'center', 'right', null])
  })

  it('round trips byte-identical', () => {
    expect(serializeMarkdown(parseMarkdown(ALIGNED).doc).trim()).toBe(ALIGNED.trim())
  })

  it('keeps plain separators plain', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    expect(serializeMarkdown(parseMarkdown(md).doc).trim()).toBe(md)
  })
})
