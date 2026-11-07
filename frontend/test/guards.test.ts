import { describe, it, expect, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { extensions } from '../src/editor/extensions'
import { SplitGuard } from '../src/editor/guards'
import { parseMarkdown } from '../src/markdown/parse'

function createEditor(opts?: { onBlocked?: () => void }) {
  const content = parseMarkdown('one\n\n<!-- split: A -->\n\ntwo').doc.toJSON()
  const exts = opts?.onBlocked
    ? [...extensions, SplitGuard.configure({ onBlocked: opts.onBlocked })]
    : [...extensions, SplitGuard]
  return new Editor({
    extensions: exts,
    content,
    element: document.createElement('div'),
  })
}

describe('SplitGuard', () => {
  it('blocks a second splitPoint and calls onBlocked', () => {
    const onBlocked = vi.fn()
    const editor = createEditor({ onBlocked })

    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      { type: 'splitPoint', attrs: { label: 'B' } }
    )

    const found: { label: string }[] = []
    editor.state.doc.descendants(node => {
      if (node.type.name === 'splitPoint') {
        found.push(node.attrs as { label: string })
      }
      return true
    })

    expect(found).toHaveLength(1)
    expect(found[0].label).toBe('A')
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('keeps a single splitPoint insert into a doc without one', () => {
    const content = parseMarkdown('hello world').doc.toJSON()
    const editor = new Editor({
      extensions: [...extensions, SplitGuard],
      content,
      element: document.createElement('div'),
    })

    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      { type: 'splitPoint', attrs: { label: 'A' } }
    )

    let count = 0
    editor.state.doc.descendants(node => {
      if (node.type.name === 'splitPoint') count++
      return true
    })

    expect(count).toBe(1)
  })

  it('undo after blocked insert restores original doc', () => {
    const original = parseMarkdown('one\n\n<!-- split: A -->\n\ntwo').doc
    const editor = createEditor()

    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      { type: 'splitPoint', attrs: { label: 'B' } }
    )

    editor.commands.undo()

    expect(editor.state.doc.toJSON()).toEqual(original.toJSON())
  })
})
