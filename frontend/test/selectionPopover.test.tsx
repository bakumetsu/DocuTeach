// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'

import { extensions } from '../src/editor/extensions'
import { parseMarkdown } from '../src/markdown/parse'
import { SelectionPopover } from '../src/editor/SelectionPopover'
import { startPageEdit } from '../src/editor/suggest/edit'

vi.mock('../src/editor/suggest/edit', () => ({
  startPageEdit: vi.fn(() => true),
}))

const editors: Editor[] = []

// jsdom has no layout; ProseMirror and floating-ui ask ranges and text nodes for rects.
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }
  const empty = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects = empty
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
})

function renderPopover() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions,
    content: parseMarkdown('Hello world').doc.toJSON(),
  })
  editors.push(editor)
  editor.commands.setTextSelection({ from: 1, to: 6 })
  render(<SelectionPopover editor={editor} />)
}

// BubbleMenu mounts its element into document.body after an effect, and hides it
// until floating-ui positions it, so the queries wait and include hidden nodes.
const button = (name: string) => screen.findByRole('button', { name, hidden: true })

afterEach(() => {
  cleanup()
  while (editors.length) editors.pop()?.destroy()
  vi.clearAllMocks()
})

describe('SelectionPopover edit panel', () => {
  it('shows the three presets as labelled buttons once Edit selection is open', async () => {
    renderPopover()
    fireEvent.click(await button('Edit selection'))
    for (const name of ['Fix mistakes', 'Simplify', 'Shorten']) {
      expect(await button(name)).toBeTruthy()
    }
  })

  it.each([
    ['Fix mistakes', 'Fix grammar and spelling mistakes'],
    ['Simplify', 'Simplify the language'],
    ['Shorten', 'Make it shorter'],
  ])('%s runs the edit with its prompt', async (name, instruction) => {
    renderPopover()
    fireEvent.click(await button('Edit selection'))
    fireEvent.click(await button(name))
    expect(startPageEdit).toHaveBeenCalledTimes(1)
    expect(startPageEdit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ instruction, scope: 'selection' }),
    )
  })
})
