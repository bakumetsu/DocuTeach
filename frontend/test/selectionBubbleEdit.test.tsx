// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { parseMarkdown } from '../src/markdown/parse'
import { getSuggestState } from '../src/editor/suggest/plugin'
import { extensions } from '../src/editor/extensions'
import { SuggestCardExtension } from '../src/editor/suggest/card'
import { useApp } from '../src/state/store'
import { useChats, resetChatsForTest } from '../src/assistant/chatStore'
import { useEditEntry } from '../src/assistant/editEntry'
import { acceptItem } from '../src/editor/suggest/apply'
import { api } from '../src/api'
import { mockConfig } from '../src/api/mock/config'
import { useEditError } from '../src/editor/suggest/edit'
import { SelectionPopover } from '../src/editor/SelectionPopover'

const MD = 'Alpha\n\nBeta\n\nGamma'

function createEditor() {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const exts = [...extensions]
  if (!exts.some((e) => e.name === 'suggestCards')) {
    exts.push(SuggestCardExtension)
  }
  const editor = new Editor({
    element,
    extensions: exts,
    content: parseMarkdown(MD).doc.toJSON(),
  })
  // "Beta" occupies positions 9–13 in the parsed doc
  editor.commands.setTextSelection({ from: 9, to: 13 })
  return { editor, element }
}

beforeAll(() => {
  // Stub layout APIs so jsdom doesn't throw
  ;Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  ;Range.prototype.getBoundingClientRect = () => ({
    top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0,
    x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
})

beforeEach(async () => {
  useApp.setState({ lessonId: 'L1' })
  vi.spyOn(api.docs.checkpoints, 'create').mockResolvedValue({
    id: 'cp1', name: '', createdAt: '', markdown: '',
  })
  mockConfig.swapMs = 0
  mockConfig.loadMs = 0
  mockConfig.tokenMinMs = 0
  mockConfig.tokenMaxMs = 1
  localStorage.clear()
  resetChatsForTest()
  useEditEntry.setState({ byChat: {}, hasSelection: false, allowProtected: false })
  await useChats.getState().init()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('SelectionPopover edit bubble', () => {
  it('rewrites selected text via Enter key', async () => {
    const { editor, element } = createEditor()
    render(<SelectionPopover editor={editor} />)

    const editBtn = await screen.findByRole('button', { name: 'Edit selection', hidden: true })
    fireEvent.click(editBtn)

    const input = await screen.findByRole('textbox', { name: 'Edit instruction', hidden: true })
    fireEvent.change(input, { target: { value: 'rewrite it' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await vi.waitFor(() => {
      expect(getSuggestState(editor).running).toBe(false)
    })

    const state = getSuggestState(editor)
    expect(state.items).toHaveLength(1)

    const result = acceptItem(editor, state.items[0].opId)
    expect(result.ok).toBe(true)

    // "Beta" should be gone from the doc
    expect(editor.state.doc.textContent).toContain('(edited)')

    // One undo restores the original text
    editor.commands.undo()
    expect(editor.state.doc.textContent).not.toContain('(edited)')

    editor.destroy()
    element.remove()
  })

  it('rewrites selected text via Send edit button', async () => {
    const { editor, element } = createEditor()
    render(<SelectionPopover editor={editor} />)

    const editBtn = await screen.findByRole('button', { name: 'Edit selection', hidden: true })
    fireEvent.click(editBtn)

    const input = await screen.findByRole('textbox', { name: 'Edit instruction', hidden: true })
    fireEvent.change(input, { target: { value: 'rewrite it' } })

    const sendBtn = await screen.findByRole('button', { name: 'Send edit', hidden: true })
    fireEvent.click(sendBtn)

    await vi.waitFor(() => {
      expect(getSuggestState(editor).running).toBe(false)
    })

    const state = getSuggestState(editor)
    expect(state.items).toHaveLength(1)

    const result = acceptItem(editor, state.items[0].opId)
    expect(result.ok).toBe(true)

    expect(editor.state.doc.textContent).toContain('(edited)')

    editor.commands.undo()
    expect(editor.state.doc.textContent).not.toContain('(edited)')

    editor.destroy()
    element.remove()
  })

  async function sendTyped(editor: Editor) {
    render(<SelectionPopover editor={editor} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit selection', hidden: true }))
    const input = await screen.findByRole('textbox', { name: 'Edit instruction', hidden: true })
    fireEvent.change(input, { target: { value: 'rewrite it' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  }

  it('collapses the selection after sending so the bubble closes', async () => {
    const { editor, element } = createEditor()
    await sendTyped(editor)
    expect(editor.state.selection.empty).toBe(true)
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false))
    editor.destroy()
    element.remove()
  })

  it('shows an error when the model endpoint is offline', async () => {
    useEditError.getState().set(null)
    vi.spyOn(api.chat, 'stream').mockReturnValue(
      (async function* () {
        yield { type: 'error', message: 'down', code: 'llm_offline' }
      })() as unknown as ReturnType<typeof api.chat.stream>,
    )
    const { editor, element } = createEditor()
    await sendTyped(editor)
    await vi.waitFor(() => expect(useEditError.getState().message).toContain('not reachable'))
    editor.destroy()
    element.remove()
  })

  it('shows an error when the stream throws', async () => {
    useEditError.getState().set(null)
    vi.spyOn(api.chat, 'stream').mockImplementation(() => {
      throw new Error('network')
    })
    const { editor, element } = createEditor()
    await sendTyped(editor)
    await vi.waitFor(() => expect(useEditError.getState().message).toContain('failed'))
    editor.destroy()
    element.remove()
  })
})
