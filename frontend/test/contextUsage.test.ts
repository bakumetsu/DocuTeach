import { describe, it, expect } from 'vitest'
import { contextUsage, contextTooltip, branchMessages } from '../src/assistant/contextUsage'

describe('contextUsage', () => {
  it('returns ok below 75%', () => {
    const u = contextUsage({
      messages: [{ role: 'user', content: 'hi' }],
      refs: [],
      draft: '',
      capChars: 100000,
    })
    expect(u.level).toBe('ok')
    expect(u.warn).toBe(false)
    expect(u.ratio).toBeLessThan(0.75)
  })

  it('returns high at exactly 75%', () => {
    // SYSTEM_BASE_CHARS = 79; message content 71 chars → usedChars 150; cap 200 → ratio 0.75
    const u = contextUsage({
      messages: [{ role: 'user', content: 'a'.repeat(71) }],
      refs: [],
      draft: '',
      capChars: 200,
    })
    expect(u.usedChars).toBe(150)
    expect(u.ratio).toBe(0.75)
    expect(u.level).toBe('high')
    expect(u.warn).toBe(false)
  })

  it('returns full and warn at exactly 90%', () => {
    // message content 101 chars → usedChars 180; cap 200 → ratio 0.9
    const u = contextUsage({
      messages: [{ role: 'user', content: 'a'.repeat(101) }],
      refs: [],
      draft: '',
      capChars: 200,
    })
    expect(u.usedChars).toBe(180)
    expect(u.ratio).toBe(0.9)
    expect(u.level).toBe('full')
    expect(u.warn).toBe(true)
  })

  it('counts refs and draft', () => {
    const u = contextUsage({
      messages: [],
      refs: [{ name: 'file.txt', text: 'hello world' }],
      draft: 'draft content',
      capChars: 1000,
    })
    // ref: 'file.txt'(8) + 'hello world'(11) + 30 = 49; draft: 13; base: 79 → 141
    expect(u.usedChars).toBe(141)
  })

  it('returns full when capChars is 0', () => {
    const u = contextUsage({
      messages: [],
      refs: [],
      draft: '',
      capChars: 0,
    })
    expect(u.ratio).toBe(1)
    expect(u.level).toBe('full')
    expect(u.warn).toBe(true)
  })

  it('tooltip uses the same base as the ring: ~used / cap tokens', () => {
    const u = contextUsage({ messages: [], refs: [], draft: '', capChars: 1000 })
    expect(contextTooltip(u)).toBe('~26 / 333 tokens')
  })
})

describe('branchMessages', () => {
  const m = (id: string, replyTo?: string) => ({ id, role: 'user' as const, content: id, replyTo })
  const full = [m('1'), m('2'), m('3'), m('4'), m('5'), m('6'), m('7'), m('8'), m('9', '3'), m('10', '3'), m('11', '3')]

  it('keeps prefix through target plus all later replies', () => {
    expect(branchMessages(full, '3').map((x) => x.id)).toEqual(['1', '2', '3', '9', '10', '11'])
  })

  it('unknown id returns the same array', () => {
    expect(branchMessages(full, 'nope')).toBe(full)
  })

  it('no later reply keeps prefix through target plus last', () => {
    const short = [m('1'), m('2'), m('3'), m('4'), m('5')]
    expect(branchMessages(short, '3').map((x) => x.id)).toEqual(['1', '2', '3', '5'])
  })

  it('undefined returns unchanged', () => {
    expect(branchMessages(full, undefined)).toBe(full)
  })

  it('contextUsage with replyTo yields smaller usedChars than without', () => {
    const msgs = [
      { id: '1', role: 'user' as const, content: 'hello' },
      { id: '2', role: 'assistant' as const, content: 'hi there' },
      { id: '3', role: 'user' as const, content: 'question' },
      { id: '4', role: 'assistant' as const, content: 'answer' },
      { id: '5', role: 'user' as const, content: 'follow-up', replyTo: '3' },
    ]
    const a = contextUsage({ messages: msgs, refs: [], draft: '', capChars: 100000 })
    const b = contextUsage({ messages: msgs, refs: [], draft: '', capChars: 100000, replyTo: '3' })
    expect(b.usedChars).toBeLessThan(a.usedChars)
  })
})
