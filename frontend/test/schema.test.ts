import { describe, it, expect } from 'vitest'
import { schema } from '../src/editor/extensions'

describe('editor schema', () => {
  it('contains required node names', () => {
    const required = [
      'teacherNote',
      'blank',
      'mcq',
      'mcqQuestion',
      'mcqOption',
      'splitPoint',
      'rawBlock',
      'table',
      'bulletList',
    ]
    for (const name of required) {
      expect(schema.nodes[name], `missing node: ${name}`).toBeDefined()
    }
  })

  it('contains required marks and excludes disabled ones', () => {
    const required = ['bold', 'italic', 'underline', 'highlight']
    for (const name of required) {
      expect(schema.marks[name], `missing mark: ${name}`).toBeDefined()
    }

    const excluded = ['link', 'strike', 'code']
    for (const name of excluded) {
      expect(schema.marks[name], `mark should not exist: ${name}`).toBeUndefined()
    }
  })

  it('mcq with question + two options passes check', () => {
    const question = schema.nodes.mcqQuestion.create()
    const optionA = schema.nodes.mcqOption.create()
    const optionB = schema.nodes.mcqOption.create()
    const mcq = schema.nodes.mcq.create(null, [question, optionA, optionB])
    expect(() => mcq.check()).not.toThrow()
  })

  it('mcq with question + one option fails check', () => {
    const question = schema.nodes.mcqQuestion.create()
    const optionA = schema.nodes.mcqOption.create()
    const mcq = schema.nodes.mcq.create(null, [question, optionA])
    expect(() => mcq.check()).toThrow()
  })

  it('doc containing a teacherNote with a paragraph checks', () => {
    const para = schema.nodes.paragraph.create()
    const note = schema.nodes.teacherNote.create(null, [para])
    const doc = schema.nodes.doc.create(null, [note])
    expect(() => doc.check()).not.toThrow()
  })

  it('teacherNote cannot contain a table', () => {
    const cell = schema.nodes.tableCell.create(null, [schema.nodes.paragraph.create()])
    const row = schema.nodes.tableRow.create(null, [cell])
    const table = schema.nodes.table.create(null, [row])

    const note = schema.nodes.teacherNote.create(null, [table])
    expect(() => note.check()).toThrow()
  })

  it('blank is inline and atom', () => {
    expect(schema.nodes.blank.isInline).toBe(true)
    expect(schema.nodes.blank.isAtom).toBe(true)
  })
})
