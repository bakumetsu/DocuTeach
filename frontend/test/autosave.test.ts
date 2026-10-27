import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/react'
import { extensions } from '../src/editor/extensions'
import { parseMarkdown } from '../src/markdown/parse'
import { docToMarkdown } from '../src/editor/docio'
import { startAutosave } from '../src/files/autosave'
import { api } from '../src/api'
import { useApp } from '../src/state/store'

function createEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions,
    content: parseMarkdown('Hello').doc.toJSON(),
  })
}

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useApp.setState({ dirty: false, saveState: { kind: 'idle' } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces three quick edits into a single save', async () => {
    const editor = createEditor()
    const cleanup = startAutosave(editor)
    const saveSpy = vi.spyOn(api.docs, 'save')

    editor.commands.insertContent('x')
    editor.commands.insertContent('x')
    editor.commands.insertContent('x')

    await vi.advanceTimersByTimeAsync(900)

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledWith('draft', docToMarkdown(editor))
    expect(useApp.getState().saveState.kind).toBe('saved')
    expect(useApp.getState().dirty).toBe(true)

    cleanup()
    editor.destroy()
  })

  it('sets saveState to saving immediately on first edit', () => {
    const editor = createEditor()
    const cleanup = startAutosave(editor)

    editor.commands.insertContent('x')

    expect(useApp.getState().saveState.kind).toBe('saving')

    cleanup()
    editor.destroy()
  })

  it('sets saveState to error when save rejects', async () => {
    const editor = createEditor()
    const cleanup = startAutosave(editor)
    vi.spyOn(api.docs, 'save').mockRejectedValue(new Error('disk full'))

    editor.commands.insertContent('x')

    await vi.advanceTimersByTimeAsync(900)

    expect(useApp.getState().saveState).toEqual({ kind: 'error', reason: 'disk full' })

    cleanup()
    editor.destroy()
  })

  it('stops saving after cleanup is called', async () => {
    const editor = createEditor()
    const cleanup = startAutosave(editor)
    const saveSpy = vi.spyOn(api.docs, 'save')

    cleanup()

    editor.commands.insertContent('x')

    await vi.advanceTimersByTimeAsync(900)

    expect(saveSpy).not.toHaveBeenCalled()

    editor.destroy()
  })
})
