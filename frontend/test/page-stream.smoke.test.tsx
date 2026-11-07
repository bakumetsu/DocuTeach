import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import App from '../src/App'
import { useApp } from '../src/state/store'
import { resetChatsForTest } from '../src/assistant/chatStore'
import { mockConfig } from '../src/api/mock/config'

const LESSON_MD = `# Sample Lesson

Some introductory paragraph text.
`

function setupFetch(): void {
  vi.stubGlobal('fetch', vi.fn((): Promise<Response> => {
    return Promise.resolve(
      new Response(LESSON_MD, { status: 200, headers: { 'Content-Type': 'text/markdown' } }),
    )
  }))
}

async function sendSlash(text: string): Promise<void> {
  const textarea = await screen.findByLabelText('Message')
  fireEvent.change(textarea, { target: { value: text } })
  fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', charCode: 13 })

  // If the slash list picked the command, the textarea now holds "text " —
  // a second Enter is required to actually send.
  const val = (textarea as HTMLTextAreaElement).value
  if (val === text + ' ' || val.endsWith(' ')) {
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', charCode: 13 })
  }
}

describe('page stream smoke', () => {
  beforeEach(() => {
    localStorage.clear()
    resetChatsForTest()
    Object.assign(mockConfig, { swapMs: 0, loadMs: 0, tokenMinMs: 0, tokenMaxMs: 1 })
    useApp.setState({ view: 'edit' })
    setupFetch()
  })

  afterEach(() => {
    Object.assign(mockConfig, { swapMs: 1500, loadMs: 1500, tokenMinMs: 20, tokenMaxMs: 40 })
    cleanup()
    vi.unstubAllGlobals()
  })

  it('(a) /ccq in chat inserts a note; Revert removes it', async () => {
    render(<App />)
    // wait for .page-content to exist
    await waitFor(() => {
      expect(document.querySelector('.page-content')).not.toBeNull()
    })

    const initialNotes = document.querySelectorAll('.page-content .note').length

    await sendSlash('/ccq')

    // chat shows confirmation
    await waitFor(() => {
      expect(screen.getByText('Draft sent to the page')).not.toBeNull()
    })

    // note count increases by one
    await waitFor(() => {
      expect(document.querySelectorAll('.page-content .note').length).toBe(initialNotes + 1)
    })

    // Revert removes it
    const revertBtn = screen.getByRole('button', { name: /revert/i })
    fireEvent.click(revertBtn)

    await waitFor(() => {
      expect(document.querySelectorAll('.page-content .note').length).toBe(initialNotes)
    })
  })

  it('(b) Escape cancels a running stream without changing the doc', async () => {
    Object.assign(mockConfig, { tokenMinMs: 30, tokenMaxMs: 30 })

    render(<App />)
    await waitFor(() => {
      expect(document.querySelector('.page-content')).not.toBeNull()
    })

    const initialNotes = document.querySelectorAll('.page-content .note').length

    await sendSlash('/ccq')

    // incoming card appears
    await waitFor(() => {
      expect(document.querySelector('.page-content .incoming-card')).not.toBeNull()
    })

    // press Escape inside the editor
    const pageContent = document.querySelector('.page-content')!
    fireEvent.keyDown(pageContent, { key: 'Escape', code: 'Escape' })

    // card is removed
    await waitFor(() => {
      expect(document.querySelector('.page-content .incoming-card')).toBeNull()
    })

    // note count unchanged
    expect(document.querySelectorAll('.page-content .note').length).toBe(initialNotes)
  })

  it('(c) Student view: /ccq shows toast and sends nothing', async () => {
    useApp.setState({ view: 'student' })

    render(<App />)
    await waitFor(() => {
      expect(document.querySelector('.page-content')).not.toBeNull()
    })

    await sendSlash('/ccq')

    await waitFor(() => {
      expect(useApp.getState().toast).toBe('Page drafts work in Edit view')
    })

    // no incoming card, no new notes
    expect(document.querySelector('.page-content .incoming-card')).toBeNull()
    expect(document.querySelectorAll('.page-content .note').length).toBe(0)
  })
})
