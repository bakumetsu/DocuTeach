import { describe, it, expect } from 'vitest'
import type { Node as PMNode } from '@tiptap/pm/model'
import { schema } from '../src/editor/extensions'
import { serializeMarkdown } from '../src/markdown/serialize'

const { nodes } = schema

function makeDoc(children: PMNode[], meta?: Record<string, unknown>): PMNode {
  return nodes.doc.createChecked(
    { meta: meta ?? { raw: '', data: null, broken: false } },
    children
  )
}

function para(text: string, attrs?: Record<string, unknown>): PMNode {
  return nodes.paragraph.createChecked(attrs ?? {}, text ? [schema.text(text)] : [])
}

function heading(level: number, text: string): PMNode {
  return nodes.heading.createChecked({ level }, [schema.text(text)])
}

function bulletList(items: PMNode[]): PMNode {
  return nodes.bulletList.createChecked({}, items)
}

function orderedList(items: PMNode[]): PMNode {
  return nodes.orderedList.createChecked({}, items)
}

function listItem(children: PMNode[]): PMNode {
  return nodes.listItem.createChecked({}, children)
}

function teacherNote(children: PMNode[], tag?: string | null): PMNode {
  return nodes.teacherNote.createChecked({ tag: tag ?? null }, children)
}

function mcqNode(question: PMNode, options: PMNode[]): PMNode {
  return nodes.mcq.createChecked({}, [question, ...options])
}

function mcqQuestion(text: string): PMNode {
  return nodes.mcqQuestion.createChecked({}, text ? [schema.text(text)] : [])
}

function mcqOption(text: string, correct: boolean): PMNode {
  return nodes.mcqOption.createChecked({ correct }, [schema.text(text)])
}

function splitPoint(label: string): PMNode {
  return nodes.splitPoint.createChecked({ label })
}

function rawBlock(text: string): PMNode {
  return nodes.rawBlock.createChecked({ text })
}

function tableCell(text: string): PMNode {
  return nodes.tableCell.createChecked({}, [para(text)])
}

function tableRow(cells: PMNode[]): PMNode {
  return nodes.tableRow.createChecked({}, cells)
}

function table(rows: PMNode[]): PMNode {
  return nodes.table.createChecked({}, rows)
}

describe('serializeMarkdown', () => {
  it('empty doc produces empty string', () => {
    const d = makeDoc([para('')])
    expect(serializeMarkdown(d)).toBe('')
  })

  it('one paragraph', () => {
    const d = makeDoc([para('Hello')])
    expect(serializeMarkdown(d)).toBe('Hello\n')
  })

  it('heading level 2', () => {
    const d = makeDoc([heading(2, 'Title')])
    expect(serializeMarkdown(d)).toBe('## Title\n')
  })

  it('heading with trailing hash is escaped', () => {
    const d = makeDoc([heading(1, 'a #')])
    expect(serializeMarkdown(d)).toBe('# a \\#\n')
  })

  it('two paragraphs separated by a blank line', () => {
    const d = makeDoc([para('First'), para('Second')])
    expect(serializeMarkdown(d)).toBe('First\n\nSecond\n')
  })

  it('skipped empty paragraph', () => {
    const d = makeDoc([para(''), para('Hello')])
    expect(serializeMarkdown(d)).toBe('Hello\n')
  })

  it('bullet list', () => {
    const d = makeDoc([
      bulletList([
        listItem([para('a')]),
        listItem([para('b')]),
        listItem([para('c')]),
      ])
    ])
    expect(serializeMarkdown(d)).toBe('- a\n- b\n- c\n')
  })

  it('ordered list gives 1. 2. 3.', () => {
    const d = makeDoc([
      orderedList([
        listItem([para('a')]),
        listItem([para('b')]),
        listItem([para('c')]),
      ])
    ])
    expect(serializeMarkdown(d)).toBe('1. a\n2. b\n3. c\n')
  })

  it('nested bullet (2 spaces) and nested ordered in ordered (3 spaces)', () => {
    // Nested bullet inside bullet
    const nestedBullet = makeDoc([
      bulletList([
        listItem([para('outer'), bulletList([listItem([para('inner')])])]),
      ])
    ])
    expect(serializeMarkdown(nestedBullet)).toBe('- outer\n  - inner\n')

    // Nested ordered inside ordered
    const nestedOrdered = makeDoc([
      orderedList([
        listItem([para('outer'), orderedList([listItem([para('inner')])])]),
      ])
    ])
    expect(serializeMarkdown(nestedOrdered)).toBe('1. outer\n   1. inner\n')
  })

  it('center-aligned paragraph wrapper', () => {
    const d = makeDoc([para('Centered', { align: 'center' })])
    expect(serializeMarkdown(d)).toBe('::: {.center}\nCentered\n:::\n')
  })

  it('align ignored inside a note', () => {
    const d = makeDoc([teacherNote([para('Not aligned', { align: 'center' })])])
    expect(serializeMarkdown(d)).toBe('::: teacher\nNot aligned\n:::\n')
  })

  it('teacherNote with tag', () => {
    const d = makeDoc([teacherNote([para('Is the action finished?')], 'CCQ')])
    expect(serializeMarkdown(d)).toBe('::: teacher {tag="CCQ"}\nIs the action finished?\n:::\n')
  })

  it('teacherNote without tag', () => {
    const d = makeDoc([teacherNote([para('A note')])])
    expect(serializeMarkdown(d)).toBe('::: teacher\nA note\n:::\n')
  })

  it('tag with a double quote is escaped', () => {
    const d = makeDoc([teacherNote([para('Test')], 'He said "hi"')])
    expect(serializeMarkdown(d)).toBe('::: teacher {tag="He said \\"hi\\""}\nTest\n:::\n')
  })

  it('note containing a list', () => {
    const d = makeDoc([
      teacherNote([
        para('Intro'),
        bulletList([listItem([para('item')])]),
      ])
    ])
    expect(serializeMarkdown(d)).toBe('::: teacher\nIntro\n\n- item\n:::\n')
  })

  it('mcq with question (no blank line) and a correct option', () => {
    const d = makeDoc([
      mcqNode(
        mcqQuestion('She ______ in Hanoi since 2019.'),
        [
          mcqOption('lives', false),
          mcqOption('has lived', true),
          mcqOption('is living', false),
        ]
      )
    ])
    expect(serializeMarkdown(d)).toBe(
      'She ______ in Hanoi since 2019.\n- [ ] lives\n- [x] has lived\n- [ ] is living\n'
    )
  })

  it('mcq with empty question', () => {
    const d = makeDoc([
      mcqNode(
        mcqQuestion(''),
        [
          mcqOption('lives', false),
          mcqOption('has lived', true),
        ]
      )
    ])
    expect(serializeMarkdown(d)).toBe('- [ ] lives\n- [x] has lived\n')
  })

  it('splitPoint', () => {
    const d = makeDoc([splitPoint('Homework starts here')])
    expect(serializeMarkdown(d)).toBe('<!-- split: Homework starts here -->\n')
  })

  it('rawBlock verbatim (multi-line code fence)', () => {
    const code = '```python\nprint("hi")\n```'
    const d = makeDoc([rawBlock(code)])
    expect(serializeMarkdown(d)).toBe('```python\nprint("hi")\n```\n')
  })

  it('2x2 table with a blank cell content {{a | b}}', () => {
    const blankCell = nodes.tableCell.createChecked({}, [
      nodes.paragraph.createChecked({}, [
        nodes.blank.create({ answers: ['a', 'b'] })
      ])
    ])
    const d = makeDoc([
      table([
        tableRow([tableCell('Tense'), tableCell('Example')]),
        tableRow([tableCell('Present perfect'), blankCell]),
      ])
    ])
    expect(serializeMarkdown(d)).toBe(
      '| Tense | Example |\n| --- | --- |\n| Present perfect | {{a | b}} |\n'
    )
  })

  it('front matter emitted first when meta.raw is set', () => {
    const meta = { raw: 'lesson_type: lesson', data: null, broken: false }
    const d = makeDoc([para('Hello')], meta)
    expect(serializeMarkdown(d)).toBe('---\nlesson_type: lesson\n---\n\nHello\n')
  })
})
