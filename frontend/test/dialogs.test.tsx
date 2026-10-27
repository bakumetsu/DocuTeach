import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { useApp } from '../src/state/store'
import { extensions } from '../src/editor/extensions'
import { parseMarkdown } from '../src/markdown/parse'
import { PageStyleDialog } from '../src/ui/dialogs/PageStyleDialog'
import { SplitDialog } from '../src/ui/dialogs/SplitDialog'

function createEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions,
    content: parseMarkdown('Hello').doc.toJSON(),
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PageStyleDialog', () => {
  it('applies page style and closes', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<PageStyleDialog open onClose={onClose} />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'Verdana' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(editor.state.doc.attrs.meta.raw).toContain('Verdana')
    expect(onClose).toHaveBeenCalled()

    editor.commands.undo()
    expect(editor.state.doc.attrs.meta.raw).toBe('')
  })

  it('cancel leaves meta unchanged', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<PageStyleDialog open onClose={onClose} />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'Verdana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(editor.state.doc.attrs.meta.raw).toBe('')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SplitDialog', () => {
  it('writes exam lesson type on OK', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Exam' }))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(editor.state.doc.attrs.meta.raw).toContain('lesson_type: exam')
    expect(onClose).toHaveBeenCalled()
  })

  it('disables OK for overlapping page ranges and shows error', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    render(<SplitDialog open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: 'By page ranges' }))
    const input = screen.getByLabelText('Page ranges')
    fireEvent.change(input, { target: { value: '1-3, 2-5' } })

    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(ok.disabled).toBe(true)
    expect(
      screen.getByText('Ranges must go up and not overlap'),
    ).toBeTruthy()
  })

  it('enables OK for valid page ranges', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    render(<SplitDialog open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: 'By page ranges' }))
    const input = screen.getByLabelText('Page ranges')
    fireEvent.change(input, { target: { value: '1-3, 5-8' } })

    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(ok.disabled).toBe(false)
  })
})
