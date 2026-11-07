import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { numberQuestions } from '../src/editor/numbering'
import { parseMarkdown } from '../src/markdown/parse'

interface Case {
  name: string
  markdown: string
  labels: string[]
}

const cases: Case[] = JSON.parse(
  readFileSync(join(__dirname, '../../backend/tests/fixtures/numbering-cases.json'), 'utf8'),
)

describe('numberQuestions fixtures', () => {
  for (const c of cases) {
    it(c.name, () => {
      const { doc } = parseMarkdown(c.markdown)
      expect(numberQuestions(doc).map(q => q.label)).toEqual(c.labels)
    })
  }
})

describe('numberQuestions positions', () => {
  it('item pos points at the listItem, textPos inside its paragraph, listPos at the list', () => {
    const { doc } = parseMarkdown('1. I {{am}}.\n2. You {{are}}.')
    const nums = numberQuestions(doc)
    expect(nums).toHaveLength(2)
    expect(nums[0].kind).toBe('item')
    expect(doc.nodeAt(nums[0].pos)?.type.name).toBe('listItem')
    expect(doc.nodeAt(nums[0].listPos!)?.type.name).toBe('orderedList')
    expect(doc.resolve(nums[0].textPos).parent.type.name).toBe('paragraph')
  })

  it('paragraph with a blank is numbered, textPos is inside it', () => {
    const { doc } = parseMarkdown('She {{is}} happy.')
    const [q] = numberQuestions(doc)
    expect(q.kind).toBe('paragraph')
    expect(doc.resolve(q.textPos).parent.type.name).toBe('paragraph')
  })

  it('mcq is numbered with kind mcq', () => {
    const { doc } = parseMarkdown('Which?\n- [ ] a\n- [x] b')
    const [q] = numberQuestions(doc)
    expect(q.kind).toBe('mcq')
    expect(q.label).toBe('1')
  })

  it('ordered list inside a teacher note does not count', () => {
    const { doc } = parseMarkdown('::: teacher {tag="Notes"}\n1. a {{x}}\n2. b {{y}}\n:::')
    expect(numberQuestions(doc)).toHaveLength(0)
  })

  it('level-1 heading does not restart numbering', () => {
    const { doc } = parseMarkdown('1. a {{x}}\n\n# Title\n\n2. b {{y}}')
    expect(numberQuestions(doc).map(q => q.label)).toEqual(['1', '2'])
  })
})
