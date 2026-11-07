import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import App from '../src/App'
import { useApp } from '../src/state/store'
import { resetChatsForTest } from '../src/assistant/chatStore'
import { mockConfig } from '../src/api/mock/config'

const REPLY_TIMEOUT = { timeout: 5000 }

const setMockDelaysToFast = () => {
  const cfg = mockConfig as Record<string, unknown>
  for (const key of Object.keys(cfg)) {
    if (typeof cfg[key] === 'number') cfg[key] = 1
  }
}

const send = async (text: string, replies: number) => {
  const textarea = await screen.findByLabelText('Message')
  fireEvent.change(textarea, { target: { value: text } })
  fireEvent.keyDown(textarea, { key: 'Enter' })
  await waitFor(() => {
    expect(document.querySelectorAll('.msg.assistant .msg-content').length).toBe(replies)
    expect([...document.querySelectorAll('.msg.assistant .msg-content')].at(-1)?.textContent).toMatch(/scripted reply/)
  }, REPLY_TIMEOUT)
  await waitFor(() => expect(screen.queryByLabelText('Stop')).toBeNull(), REPLY_TIMEOUT)
}

const select = (from: Node, fromOff: number, to: Node, toOff: number) => {
  act(() => {
    window.getSelection()!.setBaseAndExtent(from, fromOff, to, toOff)
    document.dispatchEvent(new Event('selectionchange'))
  })
}

const textNode = (el: Element): Text => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text
}

vi.setConfig({ testTimeout: 20000 })

describe('Copy selection in the chat', () => {
  const writeText = vi.fn(async () => {})

  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = url === '/sample/lesson.md' ? readFileSync('public/sample/lesson.md', 'utf-8') : ''
      return { ok: true, text: async () => body, json: async () => ({}) } as unknown as Response
    }))
  })

  beforeEach(() => {
    localStorage.clear()
    resetChatsForTest()
    useApp.setState({ view: 'edit' })
    setMockDelaysToFast()
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    cleanup()
  })

  const renderApp = async () => {
    render(<App />)
    await waitFor(() => expect(document.querySelector('.page-content')).not.toBeNull())
  }

  it('offers the button only on the reply holding the selection and copies exactly it', async () => {
    await renderApp()
    await send('hello', 1)
    await send('again', 2)
    const contents = document.querySelectorAll('.msg.assistant .msg-content')
    expect(screen.queryByLabelText('Copy selection')).toBeNull()

    select(textNode(contents[0]), 0, textNode(contents[0]), 3)
    const buttons = screen.getAllByLabelText('Copy selection')
    expect(buttons).toHaveLength(1)
    expect(contents[0].closest('.msg')!.contains(buttons[0])).toBe(true)

    fireEvent.click(buttons[0])
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith((contents[0].textContent ?? '').slice(0, 3))
  })

  it('copies the rendered text of a selection from the paragraph into a table cell', async () => {
    await renderApp()
    await send('give me a table', 1)
    const content = document.querySelector('.msg.assistant .msg-content')!
    expect(content.querySelector('table')).not.toBeNull()
    const cells = content.querySelectorAll('td')
    select(textNode(content), 0, textNode(cells[1]), 5)
    fireEvent.click(await screen.findByLabelText('Copy selection'))
    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = (writeText.mock.calls[0] as unknown as [string])[0]
    expect(copied).toContain('scripted reply')
    expect(copied).toContain('She h')
  })

  it('shows no button for a selection across two messages', async () => {
    await renderApp()
    await send('hello', 1)
    await send('again', 2)
    const contents = document.querySelectorAll('.msg.assistant .msg-content')
    select(textNode(contents[0]), 0, textNode(contents[1]), 3)
    expect(screen.queryByLabelText('Copy selection')).toBeNull()
  })

  it('shows no button for a selection in a user message', async () => {
    await renderApp()
    await send('hello', 1)
    const user = document.querySelector('.msg.user .msg-content')!
    select(textNode(user), 0, textNode(user), 3)
    expect(screen.queryByLabelText('Copy selection')).toBeNull()
  })

  it('Copy message still copies the full content', async () => {
    await renderApp()
    await send('hello', 1)
    const content = document.querySelector('.msg.assistant .msg-content')!
    const bar = content.closest('.msg')!
    fireEvent.click(bar.querySelector('[aria-label="Copy message"]')!)
    expect(writeText).toHaveBeenCalledWith(content.textContent)
  })
})
