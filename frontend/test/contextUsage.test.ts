import { describe, it, expect } from 'vitest'
import { contextUsage, contextTooltip } from '../src/assistant/contextUsage'

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

  it('tooltip contains estimate text when estimated is true', () => {
    const u = contextUsage({
      messages: [],
      refs: [],
      draft: '',
      capChars: 1000,
    })
    const tooltip = contextTooltip(u, true, 8192)
    expect(tooltip).toContain('estimate')
    expect(tooltip).toContain('model window 8192 tokens')
  })

  it('tooltip does not contain estimate text when estimated is false', () => {
    const u = contextUsage({
      messages: [],
      refs: [],
      draft: '',
      capChars: 1000,
    })
    const tooltip = contextTooltip(u, false, null)
    expect(tooltip).not.toContain('estimate')
    expect(tooltip).not.toContain('model window')
  })
})
