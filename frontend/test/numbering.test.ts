import { describe, it, expect } from 'vitest'
import { numberQuestions } from '../src/editor/numbering'
import { parseMarkdown } from '../src/markdown/parse'

describe('numberQuestions', () => {
  it('(a) section 0: two ordered items get labels 1, 2', () => {
    const { doc } = parseMarkdown('1. a\n2. b')
    const nums = numberQuestions(doc)
    expect(nums.map(q => q.label)).toEqual(['1', '2'])
    expect(nums.every(q => q.section === 0)).toBe(true)
  })

  it('(b) two sections ## A and ## B, each with 2 items', () => {
    const { doc } = parseMarkdown('## A\n1. a\n2. b\n\n## B\n1. c\n2. d')
    const nums = numberQuestions(doc)
    expect(nums.map(q => q.label)).toEqual(['1.1', '1.2', '2.1', '2.2'])
  })

  it('(c) teacherNote between two questions does not restart n', () => {
    const { doc } = parseMarkdown('1. a\n\n:::teacher\nnote\n:::\n\n1. b')
    const nums = numberQuestions(doc)
    expect(nums.map(q => q.n)).toEqual([1, 2])
    expect(nums.every(q => q.section === 0)).toBe(true)
  })

  it('(d) MCQ counts and continues numbering', () => {
    const { doc } = parseMarkdown(
      '1. a\n\nWhat is 2+2?\n- [ ] 3\n- [x] 4\n\n1. b'
    )
    const nums = numberQuestions(doc)
    expect(nums.map(q => q.n)).toEqual([1, 2, 3])
  })

  it('(e) bullet list and nested ordered list inside an item do not count', () => {
    const { doc } = parseMarkdown(
      '- bullet\n- bullet\n\n1. a\n   1. nested\n   2. nested'
    )
    const nums = numberQuestions(doc)
    expect(nums).toHaveLength(1)
    expect(nums[0].n).toBe(1)
    expect(nums[0].label).toBe('1')
  })

  it('(f) ordered list inside a teacher note does not count', () => {
    const { doc } = parseMarkdown(':::teacher\n1. a\n2. b\n:::')
    const nums = numberQuestions(doc)
    expect(nums).toHaveLength(0)
  })

  it('(g) level-1 heading does not start a section', () => {
    const { doc } = parseMarkdown('# Title\n1. a\n2. b')
    const nums = numberQuestions(doc)
    expect(nums.map(q => q.label)).toEqual(['1', '2'])
    expect(nums.every(q => q.section === 0)).toBe(true)
  })

  it('(h) typed numbers in heading text are just text', () => {
    const { doc } = parseMarkdown('## 1. Rule\n1. a\n2. b')
    const nums = numberQuestions(doc)
    expect(nums.map(q => q.label)).toEqual(['1.1', '1.2'])
    expect(nums.every(q => q.section === 1)).toBe(true)
  })

  it('(i) pos of first question points at the listItem', () => {
    const { doc } = parseMarkdown('1. a\n2. b')
    const nums = numberQuestions(doc)
    expect(nums.length).toBeGreaterThan(0)
    const nodeAt = doc.nodeAt(nums[0].pos)
    expect(nodeAt?.type.name).toBe('listItem')
  })
})
