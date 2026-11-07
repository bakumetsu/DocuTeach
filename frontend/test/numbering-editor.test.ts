// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'

import { extensions } from '../src/editor/extensions'
import { QuestionNumbering } from '../src/editor/numberingPlugin'
import { removeTypedNumbers } from '../src/editor/commands'
import { parseMarkdown } from '../src/markdown/parse'
import { serializeMarkdown } from '../src/markdown/serialize'

const editors: Editor[] = []

function makeEditor(md: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...extensions, QuestionNumbering],
    content: parseMarkdown(md).doc.toJSON(),
  })
  editors.push(editor)
  return editor
}

function widgetLabels(editor: Editor): string[] {
  return Array.from(editor.view.dom.querySelectorAll('.q-num')).map(el => el.textContent ?? '')
}

afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

describe('removeTypedNumbers', () => {
  it('removes typed prefixes from questions', () => {
    const ed = makeEditor('1. I {{am}}.\n2. You {{are}}.')
    // type the prefixes into the text
    const md = '1. 1. I {{am}}.\n2. (2) You {{are}}.'
    ed.commands.setContent(parseMarkdown(md).doc.toJSON())
    const n = removeTypedNumbers(ed)
    expect(n).toBe(1)
    expect(ed.state.doc.textContent.startsWith('I ')).toBe(true)
  })

  it('removes bold-wrapped and plain prefixes, leaves non-questions alone', () => {
    const ed = makeEditor('1. (1) I {{am}}.\n2. **(2)** You {{are}}.\n\n1. Read this.')
    const before = serializeMarkdown(ed.state.doc)
    const n = removeTypedNumbers(ed)
    const after = serializeMarkdown(ed.state.doc)
    expect(n).toBeGreaterThanOrEqual(2)
    expect(after).toContain('Read this.')
    expect(after).not.toContain('(1)')
    expect(before).not.toBe(after)
  })

  it('does nothing when no typed numbers exist', () => {
    const ed = makeEditor('1. I {{am}}.\n2. You {{are}}.')
    expect(removeTypedNumbers(ed)).toBe(0)
  })

  it('is a single undo step', () => {
    const ed = makeEditor('1. (1) I {{am}}.\n2. (2) You {{are}}.')
    const before = serializeMarkdown(ed.state.doc)
    expect(removeTypedNumbers(ed)).toBe(2)
    ed.commands.undo()
    expect(serializeMarkdown(ed.state.doc)).toBe(before)
  })
})

describe('QuestionNumbering plugin', () => {
  it('renders widgets and keeps them out of the markdown', () => {
    const ed = makeEditor('1. I {{am}}.\n2. You {{are}}.')
    expect(widgetLabels(ed)).toEqual(['1.', '2.'])
    expect(serializeMarkdown(ed.state.doc)).not.toMatch(/q-num/)
    expect(ed.state.doc.textContent).not.toContain('1.')
  })

  it('closes up after the first question is deleted', () => {
    const ed = makeEditor('Intro.\n\nShe {{is}} happy.\n\nHe {{was}} sad.')
    expect(widgetLabels(ed)).toEqual(['1.', '2.'])
    const first = ed.state.doc.child(1)
    const from = ed.state.doc.child(0).nodeSize
    ed.view.dispatch(ed.state.tr.delete(from, from + first.nodeSize))
    expect(widgetLabels(ed)).toEqual(['1.'])
  })

  it('renumbers after a question moves', () => {
    const ed = makeEditor('Which?\n- [ ] a\n- [x] b\n\nShe {{is}} happy.')
    expect(widgetLabels(ed)).toEqual(['1.', '2.'])
    const doc = ed.state.doc
    const first = doc.child(0)
    const tr = ed.state.tr.delete(0, first.nodeSize)
    tr.insert(tr.doc.content.size, first)
    ed.view.dispatch(tr)
    expect(widgetLabels(ed)).toEqual(['1.', '2.'])
    expect(ed.state.doc.child(0).type.name).toBe('paragraph')
  })
})

describe('removeTypedNumbers bold prefix', () => {
  it('removes **1.** entirely, leaves no empty bold, keeps the blank', () => {
    const ed = makeEditor('**1.** She {{has lived}} here.\n\n**2.** He {{was}} sad.')
    expect(removeTypedNumbers(ed)).toBe(2)
    const md = serializeMarkdown(ed.state.doc)
    const lines = md.split('\n').filter(l => l.trim())
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^She \{\{has lived\}\}/)
    expect(lines[1]).toMatch(/^He \{\{was\}\}/)
    expect(md).not.toMatch(/\*\*\*\*|\d\./)
  })
})
