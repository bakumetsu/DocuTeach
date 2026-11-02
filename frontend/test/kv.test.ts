import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function ensureNoMeta(): void {
  document.head.querySelector('meta[name="docuteach-token"]')?.remove()
}

function addMeta(): void {
  const m = document.createElement('meta')
  m.setAttribute('name', 'docuteach-token')
  m.setAttribute('content', 'test-token-123')
  document.head.appendChild(m)
}

describe('kv — dev mode (no meta token)', () => {
  beforeEach(async () => {
    ensureNoMeta()
    localStorage.clear()
    vi.resetModules()
  })

  it('kvGet/kvSet/kvRemove use localStorage directly', async () => {
    const { kvGet, kvSet, kvRemove, isStoreMode } = await import('../src/api/kv')
    expect(isStoreMode()).toBe(false)

    kvSet('k1', 'v1')
    expect(kvGet('k1')).toBe('v1')
    expect(localStorage.getItem('k1')).toBe('v1')

    kvRemove('k1')
    expect(kvGet('k1')).toBeNull()
    expect(localStorage.getItem('k1')).toBeNull()
  })

  it('kvInit resolves immediately in dev mode', async () => {
    const { kvInit } = await import('../src/api/kv')
    await expect(kvInit()).resolves.toBeUndefined()
  })
})

describe('kv — store mode (meta token present)', () => {
  beforeEach(async () => {
    addMeta()
    vi.resetModules()
  })

  afterEach(() => {
    ensureNoMeta()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('kvInit rejects on non-OK response and never touches localStorage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()

    const { kvInit } = await import('../src/api/kv')
    await expect(kvInit()).rejects.toThrow('HTTP 500')
    expect(localStorage.length).toBe(0)
  })

  it('kvInit populates the map from GET /_store', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ 'key1': 'val1', 'key2': 'val2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { kvInit, kvGet } = await import('../src/api/kv')
    await kvInit()
    expect(kvGet('key1')).toBe('val1')
    expect(kvGet('key2')).toBe('val2')
    expect(kvGet('missing')).toBeNull()
  })

  it('kvSet debounces and sends one PUT per key; latest value wins', async () => {
    vi.useFakeTimers()
    const calls: { body: string }[] = []
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      calls.push({ body: String(init.body) })
      return { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { kvSet, kvGet } = await import('../src/api/kv')

    kvSet('mykey', 'first')
    kvSet('mykey', 'second')
    kvSet('mykey', 'third')
    expect(kvGet('mykey')).toBe('third')

    // No request yet (debounce not elapsed)
    expect(fetchMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    await vi.runOnlyPendingTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(calls[0].body)
    expect(parsed.value).toBe('third')
    expect(parsed.seq).toBe(3)
  })

  it('kvRemove sends DELETE with seq', async () => {
    vi.useFakeTimers()
    const calls: { method: string; body: string }[] = []
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? '', body: String(init.body) })
      return { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { kvSet, kvRemove } = await import('../src/api/kv')

    kvSet('to-del', 'x')
    vi.advanceTimersByTime(300)
    await vi.runOnlyPendingTimersAsync()

    kvRemove('to-del')
    vi.advanceTimersByTime(300)
    await vi.runOnlyPendingTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(calls[1].method).toBe('DELETE')
    expect(JSON.parse(calls[1].body).seq).toBe(2)
  })

  it('window.__docuteachFlush sends pending values and sets __docuteachFlushed', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const { kvSet } = await import('../src/api/kv')

    kvSet('a', '1')
    kvSet('b', '2')

    const flushPromise = window.__docuteachFlush()
    expect(window.__docuteachFlushed).toBe(false)

    await vi.runOnlyPendingTimersAsync()
    await flushPromise

    expect(window.__docuteachFlushed).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('dispatches docuteach:save-error once after 3 retries', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const listener = vi.fn()
    window.addEventListener('docuteach:save-error', listener)

    const { kvSet } = await import('../src/api/kv')
    kvSet('err-key', 'val')

    // Advance through debounce + 3 retry delays
    vi.advanceTimersByTime(300)
    await vi.runOnlyPendingTimersAsync()
    vi.advanceTimersByTime(200)
    await vi.runOnlyPendingTimersAsync()
    vi.advanceTimersByTime(400)
    await vi.runOnlyPendingTimersAsync()
    vi.advanceTimersByTime(800)
    await vi.runOnlyPendingTimersAsync()

    // 1 initial + 3 retries = 4 fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toContain('err-key')

    window.removeEventListener('docuteach:save-error', listener)
  })

  it('409 is ignored silently (no error event)', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 })
    vi.stubGlobal('fetch', fetchMock)

    const listener = vi.fn()
    window.addEventListener('docuteach:save-error', listener)

    const { kvSet } = await import('../src/api/kv')
    kvSet('conflict-key', 'val')

    vi.advanceTimersByTime(300)
    await vi.runOnlyPendingTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()

    window.removeEventListener('docuteach:save-error', listener)
  })
})
