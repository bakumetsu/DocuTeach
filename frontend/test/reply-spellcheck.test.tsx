import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import App from '../src/App'
import { useApp } from '../src/state/store'
import { useChats, resetChatsForTest } from '../src/assistant/chatStore'
import { mockConfig } from '../src/api/mock/config'

const readLesson = (): string => readFileSync('public/sample/lesson.md', 'utf-8')

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

describe('Reply & spellcheck', () => {
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

  beforeAll(() => {
    // jsdom has no layout; the bubble menu asks for client rects.
    const zero = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
    const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
    for (const proto of [Element.prototype, Range.prototype]) {
      if (!proto.getClientRects) proto.getClientRects = rects
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = () => zero as DOMRect
    }
  })

  beforeEach(() => {
    localStorage.clear()
    resetChatsForTest()
    useApp.setState({ view: 'edit', spellcheck: true })
    setMockDelaysToFast()
  })

  afterEach(cleanup)

  it('spellcheck defaults on and persists', () => {
    expect(useApp.getState().spellcheck).toBe(true)

useApp.getState().setSpellcheck(false)
    expect(localStorage.getItem('docuteach:v1:spellcheck')).toBe('false')
  })

  it('Options > Spell check toggles the editor attribute', async () => {
    await renderApp()

    const pageContent = document.querySelector('.page-content') as HTMLElement
    expect(pageContent.getAttribute('spellcheck')).toBe('true')

    const optionsBtn = await screen.findByRole('button', { name: 'Options' })
    fireEvent.click(optionsBtn)

    const spellCheckItem = await screen.findByRole('menuitemcheckbox', { name: /Spell check/ })
    fireEvent.click(spellCheckItem)

    await waitFor(() => {
      expect(pageContent.getAttribute('spellcheck')).toBe('false')
    })
  })

  it('quoteIntoInput quotes multi-line text and does not send', async () => {
    await renderApp()

    useChats.getState().quoteIntoInput('one\n\ntwo')

    const { inputs: inputsAfter, activeId: idAfter } = useChats.getState()
    expect(inputsAfter[idAfter]).toBe('> one\n>\n> two\n\n')

    const { chats, activeId: aid } = useChats.getState()
    const activeChat = chats.find((c) => c.id === aid)
    expect(activeChat!.messages).toHaveLength(0)

    const nonceBeforeSecond = useChats.getState().focusNonce

    useChats.getState().quoteIntoInput('three')

    const { inputs: inputsSecond, activeId: idSecond, focusNonce: nonceAfterSecond } =
      useChats.getState()
    expect(inputsSecond[idSecond]).toBe('> one\n>\n> two\n\n> three\n\n')
    expect(nonceAfterSecond).toBeGreaterThan(nonceBeforeSecond)
  })

  it('Reply from a chat message quotes the selection', async () => {
    await renderApp()

    const textarea = await screen.findByLabelText('Message')
    fireEvent.change(textarea, { target: { value: 'hello' } })

    const sendBtn = await screen.findByLabelText('Send')
    fireEvent.click(sendBtn)

    const msgContent = await waitFor(
      () => {
        const el = document.querySelector('.msg.assistant .msg-content')
        expect(el).not.toBeNull()
        return el as HTMLElement
      },
    )

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'picked',
      anchorNode: msgContent,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ top: 10, left: 5 }),
      }),
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
      removeRange: vi.fn(),
      extendRange: vi.fn(),
      getComposedRange: () => [],
      setBaseAndExtent: vi.fn(),
      collapse: vi.fn(),
      collapseToStart: vi.fn(),
      collapseToEnd: vi.fn(),
      deleteFromDocument: vi.fn(),
      selectNode: vi.fn(),
      selectNodeContents: vi.fn(),
      selectAllChildren: vi.fn(),
      pointFromNode: () => null,
      pointFromIndex: () => null,
      documentFromPoint: () => null,
      modify: vi.fn(),
    } as unknown as Selection)

    const chatMessages = document.querySelector('.chat-messages') as HTMLElement
    fireEvent.mouseUp(chatMessages)

    const replyBtn = await screen.findByRole('button', { name: 'Reply' })
    fireEvent.mouseDown(replyBtn)
    fireEvent.click(replyBtn)

    const msgTextarea = await screen.findByLabelText('Message')
    expect((msgTextarea as HTMLTextAreaElement).value).toBe('> picked\n\n')

    vi.restoreAllMocks()
  })

  it('Reply from an editor selection quotes it', async () => {
    await renderApp()

    const ed = useApp.getState().editor!
    ed.commands.setTextSelection({ from: 1, to: 6 })
    const expected = ed.state.doc.textBetween(1, 6, ' ')

    const replyBtn = await waitFor(
      () => {
        const el = document.querySelector('.selection-popover button[aria-label="Reply"]')
        expect(el).not.toBeNull()
        return el as HTMLButtonElement
      },
      { timeout: 5000 },
    )

    fireEvent.click(replyBtn)

    const msgTextarea = await screen.findByLabelText('Message')
    expect((msgTextarea as HTMLTextAreaElement).value).toContain('> ' + expected)
  })
})
