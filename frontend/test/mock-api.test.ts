import { describe, it, expect, beforeEach } from 'vitest'
import { mockConfig } from '../src/api/mock/config'
import { mockModels, setCurrentModel, getCurrentModel } from '../src/api/mock/models'
import { mockChat, mockChats, mockSlots } from '../src/api/mock/chat'
import { mockSkills } from '../src/api/mock/skills'
import { scriptFor, tokenize } from '../src/api/mock/script'
import { parseFragment } from '../src/markdown/parse'
import type { ChatRequest, StreamEvent } from '../src/api/types'
import type { Node as PMNode } from '@tiptap/pm/model'

function countByType(nodes: PMNode[], name: string): number {
  let count = 0
  for (const node of nodes) {
    if (node.type.name === name) {
      count += 1
    }
    node.descendants((n: PMNode) => {
      if (n.type.name === name) {
        count += 1
      }
    })
  }
  return count
}

describe('mock api', () => {
  beforeEach(() => {
    mockConfig.swapMs = 0
    mockConfig.loadMs = 0
    mockConfig.tokenMinMs = 0
    mockConfig.tokenMaxMs = 1
    setCurrentModel(null)
  })

  // --- models ---

  it('models.list returns 3 entries', async () => {
    const models = await mockModels.list()
    expect(models).toHaveLength(3)
    expect(models[0]).toEqual({ id: 'qwen-27b', label: 'Qwen 27B', sizeGb: 14.9 })
    expect(models[1]).toEqual({ id: 'gemma-12b', label: 'Gemma 12B', sizeGb: 8.1 })
    expect(models[2]).toEqual({ id: 'broken-model', label: 'Broken model', sizeGb: 6 })
  })

  it('select qwen-27b is ready; selecting again is instant', async () => {
    const r1 = await mockModels.select('qwen-27b')
    expect(r1).toEqual({ id: 'qwen-27b', status: 'ready' })
    expect(getCurrentModel()).toBe('qwen-27b')

    const r2 = await mockModels.select('qwen-27b')
    expect(r2).toEqual({ id: 'qwen-27b', status: 'ready' })
  })

  it('select broken-model fails and leaves current unchanged', async () => {
    const r = await mockModels.select('broken-model')
    expect(r).toEqual({ id: 'broken-model', status: 'failed', error: 'Could not load' })
    expect(getCurrentModel()).toBeNull()
  })

  it('abort during select throws AbortError', async () => {
    mockConfig.loadMs = 50
    const ac = new AbortController()
    const p = mockModels.select('gemma-12b', ac.signal)
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    ac.abort()
    await assertion
  })

  // --- stream ---

  it('stream with a different model yields swapping, generating, tokens, done', async () => {
    setCurrentModel(null)
    const req: ChatRequest = {
      chatId: 'c1',
      model: 'qwen-27b',
      messages: [{ role: 'user', content: 'hello' }],
    }
    const events: StreamEvent[] = []
    for await (const ev of mockChat.stream(req, new AbortController().signal)) {
      events.push(ev)
    }

    expect(events[0]).toEqual({ type: 'status', status: 'swapping' })
    expect(events[1]).toEqual({ type: 'status', status: 'generating' })
    expect(events[events.length - 1]).toEqual({ type: 'done' })

    const tokenTexts = events
      .filter((e): e is StreamEvent & { type: 'token' } => e.type === 'token')
      .map((e) => e.text)
    expect(tokenTexts.length).toBeGreaterThan(0)

    const joined = tokenTexts.join('')
    const script = scriptFor(undefined, 'hello')
    expect(joined).toBe(script.markdown)
  })

  it('/ccq stream yields exactly one structured teacherNote', async () => {
    setCurrentModel('qwen-27b')
    const req: ChatRequest = {
      chatId: 'c2',
      model: 'qwen-27b',
      skill: '/ccq',
      messages: [{ role: 'user', content: 'ccq' }],
    }
    const events: StreamEvent[] = []
    for await (const ev of mockChat.stream(req, new AbortController().signal)) {
      events.push(ev)
    }

    const structured = events.filter(
      (e): e is StreamEvent & { type: 'structured' } => e.type === 'structured',
    )
    expect(structured).toHaveLength(1)
    expect(structured[0].kind).toBe('teacherNote')

    const tokenTexts = events
      .filter((e): e is StreamEvent & { type: 'token' } => e.type === 'token')
      .map((e) => e.text)
    expect(tokenTexts.join('')).toBe(structured[0].markdown)

    const nodes: PMNode[] = parseFragment(structured[0].markdown).nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type.name).toBe('teacherNote')
  })

  it('/drills structured kind blanks parses into orderedList with 5 items and 5 blanks', async () => {
    setCurrentModel('qwen-27b')
    const req: ChatRequest = {
      chatId: 'c3',
      model: 'qwen-27b',
      skill: '/drills',
      messages: [{ role: 'user', content: 'drills' }],
    }
    const events: StreamEvent[] = []
    for await (const ev of mockChat.stream(req, new AbortController().signal)) {
      events.push(ev)
    }

    const structured = events.filter(
      (e): e is StreamEvent & { type: 'structured' } => e.type === 'structured',
    )
    expect(structured).toHaveLength(1)
    expect(structured[0].kind).toBe('blanks')

    const nodes: PMNode[] = parseFragment(structured[0].markdown).nodes
    const list = nodes.find((n: PMNode) => n.type.name === 'orderedList')
    expect(list).toBeDefined()
    if (!list) {
      return
    }
    expect(list.childCount).toBe(5)

    const blanks = countByType([list], 'blank')
    expect(blanks).toBe(5)
  })

  it('message containing [fail] yields error and no done', async () => {
    setCurrentModel('qwen-27b')
    const req: ChatRequest = {
      chatId: 'c4',
      model: 'qwen-27b',
      messages: [{ role: 'user', content: 'please [fail] me' }],
    }
    const events: StreamEvent[] = []
    for await (const ev of mockChat.stream(req, new AbortController().signal)) {
      events.push(ev)
    }

    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(events.find((e) => e.type === 'error')).toEqual({
      type: 'error',
      message: 'The assistant failed (test)',
    })
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('aborting mid-stream ends without error and releases slot', async () => {
    setCurrentModel('qwen-27b')
    const ac = new AbortController()
    const req: ChatRequest = {
      chatId: 'c5',
      model: 'qwen-27b',
      messages: [{ role: 'user', content: 'hello' }],
    }
    const stream = mockChat.stream(req, ac.signal)
    const iter = stream[Symbol.asyncIterator]()

    // Advance until we receive the first token
    let ev: StreamEvent | undefined
    let result = await iter.next()
    while (!result.done) {
      ev = result.value
      if (ev.type === 'token') break
      result = await iter.next()
    }
    expect(ev?.type).toBe('token')

    // Abort
    ac.abort()

    const next = await iter.next()
    expect(next.done).toBe(true)
    expect(mockSlots().size).toBe(0)
  })

  // --- chats / slots ---

  it('release frees a slot', async () => {
    setCurrentModel('qwen-27b')
    const req: ChatRequest = {
      chatId: 'c6',
      model: 'qwen-27b',
      messages: [{ role: 'user', content: 'hi' }],
    }
    // Run a full stream to assign a slot, then it's released in finally
    for await (const _ of mockChat.stream(req, new AbortController().signal)) {
      // consume
    }
    expect(mockSlots().size).toBe(0)

    // Manually assign via a quick stream that we abort
    const ac = new AbortController()
    const stream = mockChat.stream(req, ac.signal)
    const iter = stream[Symbol.asyncIterator]()
    await iter.next() // starts, assigns slot
    expect(mockSlots().size).toBe(1)

    await mockChats.release('c6')
    expect(mockSlots().size).toBe(0)
  })

  // --- tokenize ---

  it('tokenize round-trips', () => {
    const samples = [
      'hello world',
      'line1\nline2\n',
      'a  b\tc',
      'Gợi ý: hỏi học sinh bằng tiếng Việt nếu cần.',
      "She {{has lived | 's lived}} in Hanoi.",
      '',
    ]
    for (const s of samples) {
      const tokens = tokenize(s)
      expect(tokens.join('')).toBe(s)
    }
  })

  // --- skills ---

  it('skills.list has 3 active and 3 planned', async () => {
    const skills = await mockSkills.list()
    const active = skills.filter((s) => s.status === 'active')
    const planned = skills.filter((s) => s.status === 'planned')
    expect(active).toHaveLength(3)
    expect(planned).toHaveLength(3)
  })
})
