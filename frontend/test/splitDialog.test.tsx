import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { useApp } from '../src/state/store'
import { extensions } from '../src/editor/extensions'
import { parseMarkdown } from '../src/markdown/parse'
import { insertSplitPoint } from '../src/editor/commands'
import { SplitDialog } from '../src/ui/dialogs/SplitDialog'

const editors: Editor[] = []

function createEditor(content?: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions,
    content: parseMarkdown(content ?? 'Hello').doc.toJSON(),
  })
  editors.push(editor)
  return editor
}

function createEditorWithSplitPoint(): Editor {
  const editor = createEditor('Hello')
  editor.commands.setTextSelection({ from: 1, to: 1 })
  insertSplitPoint(editor)
  return editor
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  while (editors.length > 0) {
    editors.pop()!.destroy()
  }
})

describe('SplitDialog', () => {
  it('default open (no split point): marker checked, shows lesson files without Homework', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    const markerRadio = screen.getByRole('radio', {
      name: 'Lesson + Homework, at a split point',
    }) as HTMLInputElement
    expect(markerRadio.checked).toBe(true)

    expect(screen.getByText('No split point yet.')).toBeTruthy()
    expect(screen.getByText('Lesson (student PDF)')).toBeTruthy()
    expect(screen.getByText('Teacher guide (DOCX)')).toBeTruthy()
    expect(screen.queryByText('Homework (student PDF)')).toBeNull()
    expect(screen.getByText('Add a split point to get a separate Homework file.')).toBeTruthy()
  })

  it("clicking '＋ Add at cursor' switches to 'Split point set' and shows Homework", () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '＋ Add at cursor' }))

    expect(screen.getByText('Split point set')).toBeTruthy()
    expect(screen.getByText('Homework (student PDF)')).toBeTruthy()
  })

  it('with a split point present: shows "Split point set"; "Show it" calls onClose', () => {
    const editor = createEditorWithSplitPoint()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    expect(screen.getByText('Split point set')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show it' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Exam radio shows exam-specific files each once', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Exam' }))

    expect(screen.getByText('Exam papers are not split.')).toBeTruthy()
    expect(screen.getAllByText('Student paper (PDF)')).toHaveLength(1)
    expect(screen.getAllByText('Teacher copy with answer key (DOCX)')).toHaveLength(1)
  })

  it('page ranges are kept when switching to Exam and back', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Lesson + Homework, by page ranges' }))
    const input = screen.getByLabelText('Page ranges') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1-3, 5-8' } })

    fireEvent.click(screen.getByRole('radio', { name: 'Exam' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Lesson + Homework, by page ranges' }))

    const inputAgain = screen.getByLabelText('Page ranges') as HTMLInputElement
    expect(inputAgain.value).toBe('1-3, 5-8')
  })

  it('pages: empty field has no alert and OK disabled; invalid ranges show error', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Lesson + Homework, by page ranges' }))

    // Untouched empty field
    expect(screen.queryByRole('alert')).toBeNull()
    const okEmpty = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(okEmpty.disabled).toBe(true)

    // Type overlapping ranges
    const input = screen.getByLabelText('Page ranges') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1-3, 2-5' } })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Ranges must go up and not overlap')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Fix the ranges to see the files.')).toBeTruthy()
    const okInvalid = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(okInvalid.disabled).toBe(true)
  })

  it('OK writes meta per card', () => {
    // marker
    {
      const editor = createEditor()
      useApp.setState({
        editor,
        docMeta: editor.state.doc.attrs.meta,
      })
      render(<SplitDialog open onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'OK' }))
      expect(editor.state.doc.attrs.meta.raw).toContain('lesson_type: lesson')
      expect(editor.state.doc.attrs.meta.raw).toContain('by: marker')
      cleanup()
    }

    // pages
    {
      const editor = createEditor()
      useApp.setState({
        editor,
        docMeta: editor.state.doc.attrs.meta,
      })
      render(<SplitDialog open onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('radio', { name: 'Lesson + Homework, by page ranges' }))
      const input = screen.getByLabelText('Page ranges') as HTMLInputElement
      fireEvent.change(input, { target: { value: '1-3, 5-8' } })
      fireEvent.click(screen.getByRole('button', { name: 'OK' }))
      expect(editor.state.doc.attrs.meta.raw).toContain('by: pages')
      cleanup()
    }

    // exam
    {
      const editor = createEditor()
      useApp.setState({
        editor,
        docMeta: editor.state.doc.attrs.meta,
      })
      render(<SplitDialog open onClose={vi.fn()} />)
      fireEvent.click(screen.getByRole('radio', { name: 'Exam' }))
      fireEvent.click(screen.getByRole('button', { name: 'OK' }))
      expect(editor.state.doc.attrs.meta.raw).toContain('lesson_type: exam')
      cleanup()
    }
  })

  it('broken meta shows YAML alert and disables all controls', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: { ...editor.state.doc.attrs.meta, broken: true },
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('not valid YAML')

    const markerRadio = screen.getByRole('radio', {
      name: 'Lesson + Homework, at a split point',
    }) as HTMLInputElement
    const pagesRadio = screen.getByRole('radio', {
      name: 'Lesson + Homework, by page ranges',
    }) as HTMLInputElement
    const examRadio = screen.getByRole('radio', { name: 'Exam' }) as HTMLInputElement
    expect(markerRadio.matches(':disabled')).toBe(true)
    expect(pagesRadio.matches(':disabled')).toBe(true)
    expect(examRadio.matches(':disabled')).toBe(true)

    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(ok.disabled).toBe(true)
  })

  it('radios share name "split-mode", exactly one checked, focused on open', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    const allRadios = screen.getAllByRole('radio') as HTMLInputElement[]
    const splitModeRadios = allRadios.filter((r) => r.name === 'split-mode')
    expect(splitModeRadios).toHaveLength(3)

    const checked = splitModeRadios.filter((r) => r.checked)
    expect(checked).toHaveLength(1)

    expect(document.activeElement).toBe(checked[0])
  })

  it('Enter in the ranges field presses OK when valid', () => {
    const editor = createEditor()
    useApp.setState({
      editor,
      docMeta: editor.state.doc.attrs.meta,
    })

    const onClose = vi.fn()
    render(<SplitDialog open onClose={onClose} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Lesson + Homework, by page ranges' }))
    const input = screen.getByLabelText('Page ranges') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1-3' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onClose).toHaveBeenCalled()
    expect(editor.state.doc.attrs.meta.raw).toContain('by: pages')
  })

  it('no editor: OK disabled and all radios disabled', () => {
    const editor = createEditor()
    const meta = editor.state.doc.attrs.meta
    useApp.setState({ editor: null, docMeta: meta })

    render(<SplitDialog open onClose={vi.fn()} />)

    const ok = screen.getByRole('button', { name: 'OK' }) as HTMLButtonElement
    expect(ok.disabled).toBe(true)

    const markerRadio = screen.getByRole('radio', {
      name: 'Lesson + Homework, at a split point',
    }) as HTMLInputElement
    const pagesRadio = screen.getByRole('radio', {
      name: 'Lesson + Homework, by page ranges',
    }) as HTMLInputElement
    const examRadio = screen.getByRole('radio', { name: 'Exam' }) as HTMLInputElement
    expect(markerRadio.matches(':disabled')).toBe(true)
    expect(pagesRadio.matches(':disabled')).toBe(true)
    expect(examRadio.matches(':disabled')).toBe(true)
  })

  it('focus follows stored choice: exam radio focused when meta is exam', () => {
    const editor = createEditor()
    const meta = parseMarkdown('---\nlesson_type: exam\n---\n\nHello').doc.attrs.meta
    useApp.setState({
      editor,
      docMeta: meta,
    })

    render(<SplitDialog open onClose={vi.fn()} />)

    const examRadio = screen.getByRole('radio', { name: 'Exam' }) as HTMLInputElement
    expect(document.activeElement).toBe(examRadio)
  })
})
