import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import App from '../src/App'
import { useApp } from '../src/state/store'
import { resetChatsForTest } from '../src/assistant/chatStore'
import { mockConfig } from '../src/api/mock/config'
import { api } from '../src/api'

const readLesson = (): string => readFileSync('public/sample/lesson.md', 'utf-8')

const textOf = (el: HTMLElement): string => el.textContent ?? ''

const renderApp = async () => {
  render(<App />)
  await waitFor(() => {
    expect(document.querySelector('.page-content')).not.toBeNull()
  })
}

const setMockDelaysToFast = () => {
  const cfg = mockConfig as Record<string, unknown>
  for (const key of Object.keys(cfg)) {
    if (typeof cfg[key] === 'number') {
      cfg[key] = 1
    }
  }
}

describe('Assistant pane', () => {
  beforeAll(() => {
    const fakeFetch = async (url: string): Promise<Response> => {
      const body = url === '/sample/lesson.md' ? readLesson() : ''
      return {
        ok: true,
        text: async (): Promise<string> => body,
        json: async (): Promise<unknown> => ({}),
      } as unknown as Response
    }
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
  })

  beforeEach(() => {
    localStorage.clear()
    resetChatsForTest()
    useApp.setState({ view: 'edit' })
    setMockDelaysToFast()
  })

  afterEach(cleanup)

  it('shows the model select with 3 options', async () => {
    await renderApp()

    const select = (await screen.findByLabelText('Model')) as HTMLSelectElement
    const options = Array.from(select.querySelectorAll('option'))
    expect(options).toHaveLength(3)
  })

  it("typing '/' in Message shows a listbox with the 3 active skills", async () => {
    await renderApp()

    const textarea = await screen.findByLabelText('Message')
    fireEvent.change(textarea, { target: { value: '/' } })

    const listbox = await screen.findByRole('listbox')
    const options = await within(listbox).findAllByRole('option')
    expect(options).toHaveLength(3)

    const texts = options.map((o) => textOf(o))
    expect(texts.join('')).toContain('/ccq')
    expect(texts.join('')).toContain('/drills')
    expect(texts.join('')).toContain('/pitfalls')
  })

  it("typing '/cc' narrows the listbox to 1 option", async () => {
    await renderApp()

    const textarea = await screen.findByLabelText('Message')
    fireEvent.change(textarea, { target: { value: '/cc' } })

    const listbox = await screen.findByRole('listbox')
    const options = await within(listbox).findAllByRole('option')
    expect(options).toHaveLength(1)
    expect(textOf(options[0])).toContain('/ccq')
  })

  it("'hello' + Enter shows a user message and an assistant 'scripted reply'", async () => {
    await renderApp()

    const textarea = await screen.findByLabelText('Message')
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await screen.findByText('hello')
    await screen.findByText(/scripted reply/)
  })

  it('Skills tab lists all 6 commands with 3 "planned" badges', async () => {
    await renderApp()

    const paneTablist = await screen.findByRole('tablist', { name: 'Pane tabs' })
    const skillsTab = await within(paneTablist).findByRole('tab', { name: 'Skills' })
    fireEvent.click(skillsTab)

    const rows = await screen.findAllByRole('row')
    expect(rows).toHaveLength(7)

    const plannedBadges = await screen.findAllByText('planned')
    expect(plannedBadges).toHaveLength(3)
  })

  it("'+' New chat button adds a tab", async () => {
    await renderApp()

    const chatTablist = await screen.findByRole('tablist', { name: 'Chats' })
    const before = (await within(chatTablist).findAllByRole('tab')).length

    const newChatBtn = await screen.findByLabelText('New chat')
    fireEvent.click(newChatBtn)

    const afterTablist = await screen.findByRole('tablist', { name: 'Chats' })
    const after = await within(afterTablist).findAllByRole('tab')
    expect(after).toHaveLength(before + 1)
  })

  it('closing a chat shows "Chat closed · Undo" and Undo restores it', async () => {
    await renderApp()

    const chatTablist = await screen.findByRole('tablist', { name: 'Chats' })
    const initialCount = (await within(chatTablist).findAllByRole('tab')).length

    const closeBtn = await screen.findByLabelText('Close chat')
    fireEvent.click(closeBtn)

    const status = await screen.findByRole('status')
    expect(status.textContent ?? '').toContain('Chat closed')

    const undoBtn = await screen.findByText('Undo')
    fireEvent.click(undoBtn)

    const restoredTablist = await screen.findByRole('tablist', { name: 'Chats' })
    const restoredCount = (await within(restoredTablist).findAllByRole('tab')).length
    expect(restoredCount).toBe(initialCount)
  })

  it("selecting 'Broken model' shows 'Could not load', a Retry button, and disables Send", async () => {
    await renderApp()

    const select = (await screen.findByLabelText('Model')) as HTMLSelectElement

    const options = Array.from(select.querySelectorAll('option')) as HTMLOptionElement[]
    const brokenOption = options.find((o) => textOf(o) === 'Broken model')
    expect(brokenOption).toBeDefined()

    fireEvent.change(select, { target: { value: brokenOption!.value } })

    await screen.findByText('Could not load')
    await screen.findByText('Retry')

    const sendBtn = (await screen.findByLabelText('Send')) as HTMLButtonElement
    expect(sendBtn.disabled).toBe(true)
  })

  it("'Insert below cursor' has aria-disabled when view is 'student'", async () => {
    useApp.setState({ view: 'student' })
    await renderApp()

    const textarea = await screen.findByLabelText('Message')

    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await screen.findByText(/scripted reply/)

    const insertBtn = await screen.findByLabelText('Insert below cursor')
    expect(insertBtn.getAttribute('aria-disabled')).toBe('true')
  })

  it('shows a context ring under Send with an estimate tooltip once context info resolves', async () => {
    await renderApp()

    const textarea = await screen.findByLabelText('Message')
    fireEvent.change(textarea, { target: { value: 'hello' } })

    await screen.findByRole('img', { name: /estimate/ })
  })

  it('shows "Context almost full" warning when ratio >= 0.9, and hides it for tiny drafts', async () => {
    const spy = vi.spyOn(api.models, 'context').mockResolvedValue({ nCtx: 128, promptCapChars: 100, estimated: false })
    try {
      await renderApp()

      const textarea = await screen.findByLabelText('Message')

      // long draft pushes ratio past 0.9 → warning appears
      fireEvent.change(textarea, { target: { value: 'a'.repeat(200) } })
      await screen.findByText('Context almost full. Remove an attachment or start a new chat.')

      // tiny draft drops ratio below 0.9 → warning disappears
      fireEvent.change(textarea, { target: { value: 'hi' } })
      await waitFor(() => {
        expect(screen.queryByText('Context almost full. Remove an attachment or start a new chat.')).toBeNull()
      })
    } finally {
      spy.mockRestore()
    }
  })
})
