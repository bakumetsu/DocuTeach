// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import App from '../src/App'
import { useApp } from '../src/state/store'

const lessonText = readFileSync('public/sample/lesson.md', 'utf-8')

type DocLike = {
  descendants: (cb: (node: { type: { name: string } }) => boolean) => void
}

function countTeacherNotesInDoc(): number {
  const state = useApp.getState() as {
    editor?: {
      state: {
        doc: DocLike
      }
    }
  }

  const doc = state.editor?.state.doc
  if (!doc) return 0

  let count = 0
  doc.descendants((node) => {
    if (node.type.name === 'teacherNote') {
      count += 1
    }
    return true
  })

  return count
}

async function renderApp() {
  render(<App />)
  await waitFor(() => {
    expect(document.querySelector('.page-content')).not.toBeNull()
  }, { timeout: 5000 })
}

describe('Toolbar', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/sample/lesson.md') {
          return { ok: true, text: async () => lessonText }
        }
        return { ok: false, text: async () => '' }
      }),
    )
    localStorage.clear()
  })

  afterEach(cleanup)

  it('exposes the formatting toolbar and view tabs', async () => {
    await renderApp()

    expect(screen.getByRole('toolbar', { name: 'Formatting' })).not.toBeNull()

    const buttonNames = [
      'Bold',
      'Italic',
      'Underline',
      'Highlight',
      'Bullet list',
      'Numbered list',
      'Blank',
      'Note',
      'Choice',
      'Split',
      'Revert',
      'Redo',
      'Page style',
      'Export',
    ]

    for (const name of buttonNames) {
      expect(screen.getByRole('button', { name })).not.toBeNull()
    }

    const edit = screen.getByRole('tab', { name: 'Edit' })
    const student = screen.getByRole('tab', { name: 'Student' })
    const teacher = screen.getByRole('tab', { name: 'Teacher' })

    expect(edit.getAttribute('aria-selected')).toBe('true')
    expect(student.getAttribute('aria-selected')).not.toBe('true')
    expect(teacher.getAttribute('aria-selected')).not.toBe('true')
  })

  it('inserts a note when Note is clicked and removes it on undo', async () => {
    await renderApp()

    const before = document.querySelectorAll('.page-content .note').length

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Note' }))
    })

    await waitFor(() => {
      expect(document.querySelectorAll('.page-content .note').length).toBe(before + 1)
    })

    act(() => {
      const state = useApp.getState() as {
        editor?: {
          commands: {
            undo: () => void
          }
        }
      }
      state.editor?.commands.undo()
    })

    await waitFor(() => {
      expect(document.querySelectorAll('.page-content .note').length).toBe(before)
    })
  })

  it('inserts a choice when Choice is clicked', async () => {
    await renderApp()

    const before = document.querySelectorAll('.page-content .mcq').length

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Choice' }))
    })

    await waitFor(() => {
      expect(document.querySelectorAll('.page-content .mcq').length).toBe(before + 1)
    })
  })

  it('disables editing in Student view and does not insert notes', async () => {
    await renderApp()

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Student' }))
    })

    const student = screen.getByRole('tab', { name: 'Student' })
    expect(student.getAttribute('aria-selected')).toBe('true')

    const bold = screen.getByRole('button', { name: 'Bold' })
    expect(bold.getAttribute('aria-disabled')).toBe('true')

    const before = countTeacherNotesInDoc()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Note' }))
    })

    const after = countTeacherNotesInDoc()
    expect(after).toBe(before)

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Edit' }))
    })

    const edit = screen.getByRole('tab', { name: 'Edit' })
    expect(edit.getAttribute('aria-selected')).toBe('true')

    const boldAfter = screen.getByRole('button', { name: 'Bold' })
    expect(boldAfter.hasAttribute('aria-disabled')).toBe(false)
  })

  it('Export button is enabled', async () => {
    await renderApp()

    const exportButton = screen.getByRole('button', { name: 'Export' })
    expect(exportButton.hasAttribute('aria-disabled')).toBe(false)
  })

  it('moves focus to the next toolbar button on ArrowRight', async () => {
    await renderApp()

    const bold = screen.getByRole('button', { name: 'Bold' })
    bold.focus()

    fireEvent.keyDown(bold, { key: 'ArrowRight' })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Italic' }))
  })

  it('has Font and Size controls before Bold', async () => {
    await renderApp()

    const font = screen.getByRole('button', { name: 'Font' })
    const size = screen.getByRole('button', { name: 'Size' })
    const bold = screen.getByRole('button', { name: 'Bold' })

    expect(font.getAttribute('aria-haspopup')).toBe('menu')
    expect(size.getAttribute('aria-haspopup')).toBe('menu')

    // font precedes bold: bold follows font
    expect(font.compareDocumentPosition(bold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // size precedes bold: bold follows size
    expect(size.compareDocumentPosition(bold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sets and clears the size from the Size list', async () => {
    await renderApp()

    const state = useApp.getState() as {
      editor?: {
        commands: { selectAll: () => void }
        state: { doc: { toJSON: () => unknown } }
      }
    }

    act(() => {
      state.editor?.commands.selectAll()
    })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Size' }))
    })

    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: '14 pt' }))
    })

    await waitFor(() => {
      const s = useApp.getState() as {
        editor?: { state: { doc: { toJSON: () => unknown } } }
      }
      const json = JSON.stringify(s.editor?.state.doc.toJSON())
      expect(json).toContain('"size":14')
    })

    const sizeBtn = screen.getByRole('button', { name: 'Size' })
    expect(sizeBtn.textContent).toContain('14')

    act(() => {
      fireEvent.click(sizeBtn)
    })

    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Default' }))
    })

    await waitFor(() => {
      const s = useApp.getState() as {
        editor?: { state: { doc: { toJSON: () => unknown } } }
      }
      const json = JSON.stringify(s.editor?.state.doc.toJSON())
      expect(json).not.toContain('"size":14')
    })
  })

  it('sets the font from the Font list in one undo step', async () => {
    await renderApp()

    const state = useApp.getState() as {
      editor?: {
        commands: { selectAll: () => void; undo: () => void }
        state: { doc: { toJSON: () => unknown } }
      }
    }

    act(() => {
      state.editor?.commands.selectAll()
    })

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Font' }))
    })

    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Roboto' }))
    })

    await waitFor(() => {
      const s = useApp.getState() as {
        editor?: { state: { doc: { toJSON: () => unknown } } }
      }
      const json = JSON.stringify(s.editor?.state.doc.toJSON())
      expect(json).toContain('"font":"Roboto"')
    })

    act(() => {
      state.editor?.commands.undo()
    })

    await waitFor(() => {
      const s = useApp.getState() as {
        editor?: { state: { doc: { toJSON: () => unknown } } }
      }
      const json = JSON.stringify(s.editor?.state.doc.toJSON())
      expect(json).not.toContain('"font":"Roboto"')
    })
  })

  it('dims Font and Size outside Edit view', async () => {
    await renderApp()

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: 'Student' }))
    })

    const font = screen.getByRole('button', { name: 'Font' })
    const size = screen.getByRole('button', { name: 'Size' })

    expect(font.getAttribute('aria-disabled')).toBe('true')
    expect(size.getAttribute('aria-disabled')).toBe('true')

    act(() => {
      fireEvent.click(font)
    })

    expect(screen.queryByRole('menu', { name: 'Font list' })).toBeNull()
  })
})
