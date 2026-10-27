// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

import { extensions } from '../src/editor/extensions'
import { EditorKeymaps } from '../src/editor/keymaps'
import { SplitGuard } from '../src/editor/guards'
import {
  blankToText,
  insertBlank,
  insertMcq,
  insertSplitPoint,
  insertTeacherNote,
  setBlankAnswers,
  setNoteTag,
  toggleCorrect,
} from '../src/editor/commands'
import { parseMarkdown } from '../src/markdown/parse'
import { serializeMarkdown } from '../src/markdown/serialize'

type JsonNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
  text?: string
}

const editors: Editor[] = []

function makeEditor(md: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...extensions, EditorKeymaps, SplitGuard],
    content: parseMarkdown(md).doc.toJSON(),
  })
  editors.push(editor)
  return editor
}

function makeEditorFromJson(json: JsonNode): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...extensions, EditorKeymaps, SplitGuard],
    content: json,
  })
  editors.push(editor)
  return editor
}

function docJson(editor: Editor): JsonNode {
  return editor.state.doc.toJSON() as JsonNode
}

function findNodes(json: JsonNode, type: string): JsonNode[] {
  const out: JsonNode[] = []
  const visit = (node: JsonNode) => {
    if (node.type === type) out.push(node)
    node.content?.forEach(visit)
  }
  visit(json)
  return out
}

function findFirst(json: JsonNode, type: string): JsonNode | undefined {
  return findNodes(json, type)[0]
}

function countNodes(json: JsonNode, type: string): number {
  return findNodes(json, type).length
}

function nodePos(doc: PMNode, type: string, index = 0): number {
  let found = -1
  let count = 0
  doc.descendants((node: PMNode, pos: number) => {
    if (found !== -1) return false
    if (node.type.name === type) {
      if (count === index) {
        found = pos
        return false
      }
      count += 1
    }
    return true
  })
  return found
}

function findTextRange(
  doc: PMNode,
  text: string,
): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null
  doc.descendants((node: PMNode, pos: number) => {
    if (node.isText && node.text?.includes(text)) {
      const idx = node.text.indexOf(text)
      result = { from: pos + idx, to: pos + idx + text.length }
      return false
    }
    return true
  })
  return result
}

function hasAncestor($pos: { depth: number; node: (d: number) => PMNode }, name: string): boolean {
  for (let d = $pos.depth; d >= 1; d -= 1) {
    if ($pos.node(d).type.name === name) return true
  }
  return false
}

function insidePosForEmptyTextblock(nodePos: number): number {
  return nodePos + 1
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()!.destroy()
  }
})

describe('editor commands', () => {
  it('insertTeacherNote converts an empty paragraph and places the caret inside the note', () => {
    const editor = makeEditor('')
    editor.commands.setTextSelection({ from: 1, to: 1 })

    const before = editor.state.doc.toJSON()
    insertTeacherNote(editor)

    const json = docJson(editor)
    expect(countNodes(json, 'teacherNote')).toBe(1)
    expect(countNodes(json, 'paragraph')).toBe(1)
    const note = findFirst(json, 'teacherNote')!
    expect(note.content?.[0]?.type).toBe('paragraph')
    expect(note.content?.[0]?.content).toBeUndefined()

    const sel = editor.state.selection
    expect(sel.$from.parent.type.name).toBe('paragraph')
    expect(hasAncestor(sel.$from, 'teacherNote')).toBe(true)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('insertTeacherNote inserts after a non-empty paragraph and places the caret inside the note', () => {
    const editor = makeEditor('Hello')
    editor.commands.setTextSelection({ from: 1, to: 1 })

    const before = editor.state.doc.toJSON()
    insertTeacherNote(editor)

    const json = docJson(editor)
    expect(json.content?.map((n) => n.type)).toEqual(['paragraph', 'teacherNote'])
    expect(countNodes(json, 'teacherNote')).toBe(1)

    const sel = editor.state.selection
    expect(sel.$from.parent.type.name).toBe('paragraph')
    expect(hasAncestor(sel.$from, 'teacherNote')).toBe(true)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('insertMcq inserts an mcq with a question and three options', () => {
    const editor = makeEditor('Hello')
    editor.commands.setTextSelection({ from: 1, to: 1 })

    const before = editor.state.doc.toJSON()
    insertMcq(editor)

    const json = docJson(editor)
    const mcq = findFirst(json, 'mcq')!
    expect(mcq.attrs?.multi).toBe(false)
    expect(mcq.content?.map((n) => n.type)).toEqual([
      'mcqQuestion',
      'mcqOption',
      'mcqOption',
      'mcqOption',
    ])
    for (const option of mcq.content?.filter((n) => n.type === 'mcqOption') ?? []) {
      expect(option.attrs?.correct).toBe(false)
    }

    const sel = editor.state.selection
    expect(sel.$from.parent.type.name).toBe('mcqQuestion')
    expect(hasAncestor(sel.$from, 'mcqQuestion')).toBe(true)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('insertBlank replaces a selected word with a blank containing that word', () => {
    const editor = makeEditor('The has cat')
    const range = findTextRange(editor.state.doc, 'has')
    expect(range).not.toBeNull()
    editor.commands.setTextSelection({ from: range!.from, to: range!.to })

    const before = editor.state.doc.toJSON()
    const pos = insertBlank(editor)

    expect(editor.state.doc.nodeAt(pos)?.type.name).toBe('blank')
    const blank = findFirst(docJson(editor), 'blank')!
    expect(blank.attrs?.answers).toEqual(['has'])
    expect(serializeMarkdown(editor.state.doc)).toContain('{{has}}')

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('insertBlank inserts an empty blank when there is no selected text', () => {
    const editor = makeEditor('Hello')
    editor.commands.setTextSelection({ from: 1, to: 1 })

    const before = editor.state.doc.toJSON()
    const pos = insertBlank(editor)

    expect(editor.state.doc.nodeAt(pos)?.type.name).toBe('blank')
    const blank = findFirst(docJson(editor), 'blank')!
    expect(blank.attrs?.answers).toEqual([])

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('insertSplitPoint inserts once, then selects the existing split point', () => {
    const editor = makeEditor('Hello')
    editor.commands.setTextSelection({ from: 1, to: 1 })

    const before = editor.state.doc.toJSON()
    const first = insertSplitPoint(editor)
    expect(first).toBe('inserted')
    expect(countNodes(docJson(editor), 'splitPoint')).toBe(1)

    const second = insertSplitPoint(editor)
    expect(second).toBe('selected')
    expect(countNodes(docJson(editor), 'splitPoint')).toBe(1)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('toggleCorrect flips an option and sets multi when two options are correct', () => {
    const editor = makeEditor('Hello')
    editor.commands.setTextSelection({ from: 1, to: 1 })
    insertMcq(editor)

    const option0 = nodePos(editor.state.doc, 'mcqOption', 0)
    const option1 = nodePos(editor.state.doc, 'mcqOption', 1)

    const beforeFirst = editor.state.doc.toJSON()
    toggleCorrect(editor, option0)

    let json = docJson(editor)
    let options = findNodes(json, 'mcqOption')
    expect(options[0].attrs?.correct).toBe(true)
    expect(options[1].attrs?.correct).toBe(false)
    expect(findFirst(json, 'mcq')!.attrs?.multi).toBe(false)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(beforeFirst)

    toggleCorrect(editor, option0)
    const beforeSecond = editor.state.doc.toJSON()
    toggleCorrect(editor, option1)

    json = docJson(editor)
    options = findNodes(json, 'mcqOption')
    expect(options[0].attrs?.correct).toBe(true)
    expect(options[1].attrs?.correct).toBe(true)
    expect(findFirst(json, 'mcq')!.attrs?.multi).toBe(true)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(beforeSecond)
  })

  it('setBlankAnswers trims answers and drops empty strings', () => {
    const editor = makeEditor('Hello')
    editor.commands.setTextSelection({ from: 1, to: 1 })
    const pos = insertBlank(editor)

    const before = editor.state.doc.toJSON()
    setBlankAnswers(editor, pos, ['  a ', '', ' b '])

    const blank = findFirst(docJson(editor), 'blank')!
    expect(blank.attrs?.answers).toEqual(['a', 'b'])

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('blankToText replaces a blank with its first answer', () => {
    const editor = makeEditor('The has cat')
    const range = findTextRange(editor.state.doc, 'has')!
    editor.commands.setTextSelection({ from: range.from, to: range.to })
    const pos = insertBlank(editor)

    const before = editor.state.doc.toJSON()
    blankToText(editor, pos)

    expect(countNodes(docJson(editor), 'blank')).toBe(0)
    expect(serializeMarkdown(editor.state.doc)).toContain('has')

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('setNoteTag updates the teacher note tag', () => {
    const editor = makeEditor('')
    editor.commands.setTextSelection({ from: 1, to: 1 })
    insertTeacherNote(editor)

    const notePos = nodePos(editor.state.doc, 'teacherNote')
    const before = editor.state.doc.toJSON()
    setNoteTag(editor, notePos, 'hint')

    expect(findFirst(docJson(editor), 'teacherNote')!.attrs?.tag).toBe('hint')

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('Enter in an mcq option adds a new option after the current option', () => {
    const editor = makeEditorFromJson({
      type: 'doc',
      content: [
        {
          type: 'mcq',
          attrs: { multi: false },
          content: [
            { type: 'mcqQuestion' },
            { type: 'mcqOption', attrs: { correct: false } },
            { type: 'mcqOption', attrs: { correct: false } },
          ],
        },
      ],
    })

    const optionPos = nodePos(editor.state.doc, 'mcqOption', 0)
    editor.commands.setTextSelection({
      from: insidePosForEmptyTextblock(optionPos),
      to: insidePosForEmptyTextblock(optionPos),
    })

    const before = editor.state.doc.toJSON()
    const handled = editor.commands.keyboardShortcut('Enter')
    expect(handled).toBe(true)

    expect(countNodes(docJson(editor), 'mcqOption')).toBe(3)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('Backspace removes an empty mcq option when there are more than two options', () => {
    const editor = makeEditorFromJson({
      type: 'doc',
      content: [
        {
          type: 'mcq',
          attrs: { multi: false },
          content: [
            { type: 'mcqQuestion' },
            { type: 'mcqOption', attrs: { correct: false } },
            { type: 'mcqOption', attrs: { correct: false } },
            { type: 'mcqOption', attrs: { correct: false } },
          ],
        },
      ],
    })

    const optionPos = nodePos(editor.state.doc, 'mcqOption', 2)
    editor.commands.setTextSelection({
      from: insidePosForEmptyTextblock(optionPos),
      to: insidePosForEmptyTextblock(optionPos),
    })

    const before = editor.state.doc.toJSON()
    const handled = editor.commands.keyboardShortcut('Backspace')
    expect(handled).toBe(true)

    expect(countNodes(docJson(editor), 'mcqOption')).toBe(2)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('Backspace does not remove an empty mcq option when there are exactly two options', () => {
    const editor = makeEditorFromJson({
      type: 'doc',
      content: [
        {
          type: 'mcq',
          attrs: { multi: false },
          content: [
            { type: 'mcqQuestion' },
            { type: 'mcqOption', attrs: { correct: false } },
            { type: 'mcqOption', attrs: { correct: false } },
          ],
        },
      ],
    })

    const optionPos = nodePos(editor.state.doc, 'mcqOption', 1)
    editor.commands.setTextSelection({
      from: insidePosForEmptyTextblock(optionPos),
      to: insidePosForEmptyTextblock(optionPos),
    })

    const before = editor.state.doc.toJSON()
    const handled = editor.commands.keyboardShortcut('Backspace')
    expect(handled).toBe(true)

    expect(countNodes(docJson(editor), 'mcqOption')).toBe(2)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it('Mod-Enter toggles correct on the current mcq option and recomputes multi', () => {
    const editor = makeEditorFromJson({
      type: 'doc',
      content: [
        {
          type: 'mcq',
          attrs: { multi: false },
          content: [
            { type: 'mcqQuestion' },
            { type: 'mcqOption', attrs: { correct: false } },
            { type: 'mcqOption', attrs: { correct: false } },
            { type: 'mcqOption', attrs: { correct: false } },
          ],
        },
      ],
    })

    const optionPos = nodePos(editor.state.doc, 'mcqOption', 0)
    editor.commands.setTextSelection({
      from: insidePosForEmptyTextblock(optionPos),
      to: insidePosForEmptyTextblock(optionPos),
    })

    const before = editor.state.doc.toJSON()
    const handled = editor.commands.keyboardShortcut('Mod-Enter')
    expect(handled).toBe(true)

    let options = findNodes(docJson(editor), 'mcqOption')
    expect(options[0].attrs?.correct).toBe(true)
    expect(findFirst(docJson(editor), 'mcq')!.attrs?.multi).toBe(false)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)

    editor.commands.keyboardShortcut('Mod-Enter')
    options = findNodes(docJson(editor), 'mcqOption')
    expect(options[0].attrs?.correct).toBe(true)
    expect(findFirst(docJson(editor), 'mcq')!.attrs?.multi).toBe(false)

    editor.commands.keyboardShortcut('Mod-Enter')
    options = findNodes(docJson(editor), 'mcqOption')
    expect(options[0].attrs?.correct).toBe(false)
    expect(findFirst(docJson(editor), 'mcq')!.attrs?.multi).toBe(false)

    editor.commands.undo()
    options = findNodes(docJson(editor), 'mcqOption')
    expect(options[0].attrs?.correct).toBe(true)
    expect(findFirst(docJson(editor), 'mcq')!.attrs?.multi).toBe(false)
  })

  it('Backspace removes a teacher note whose only child is an empty paragraph', () => {
    const editor = makeEditorFromJson({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        {
          type: 'teacherNote',
          attrs: { tag: '' },
          content: [{ type: 'paragraph' }],
        },
      ],
    })

    const notePos = nodePos(editor.state.doc, 'teacherNote')
    const caretPos = notePos + 2
    editor.commands.setTextSelection({ from: caretPos, to: caretPos })

    const before = editor.state.doc.toJSON()
    const handled = editor.commands.keyboardShortcut('Backspace')
    expect(handled).toBe(true)

    expect(countNodes(docJson(editor), 'teacherNote')).toBe(0)
    expect(countNodes(docJson(editor), 'paragraph')).toBe(1)

    editor.commands.undo()
    expect(editor.state.doc.toJSON()).toEqual(before)
  })
})
