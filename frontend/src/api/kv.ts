const _token: string = document.querySelector('meta[name="docuteach-token"]')?.getAttribute('content') ?? ''

const DEBOUNCE_MS = 300
const RETRY_DELAYS = [200, 400, 800]

interface PendingOp {
  op: 'put' | 'del'
  value?: string
}

interface KeyState {
  seq: number
  pending: PendingOp | null
  inFlight: Promise<void> | null
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const store = new Map<string, string>()
const keyStates = new Map<string, KeyState>()

export function isStoreMode(): boolean {
  return _token.length > 0
}

function getState(key: string): KeyState {
  let s = keyStates.get(key)
  if (!s) {
    s = { seq: 0, pending: null, inFlight: null, debounceTimer: null }
    keyStates.set(key, s)
  }
  return s
}

export async function kvInit(): Promise<void> {
  if (!isStoreMode()) return
  const res = await fetch('/_store', {
    headers: { 'X-DocuTeach-Token': _token }
  })
  if (!res.ok) {
    throw new Error(`kvInit: HTTP ${res.status}`)
  }
  const data: Record<string, string> = await res.json()
  store.clear()
  for (const [k, v] of Object.entries(data)) {
    store.set(k, v)
  }
}

export function kvGet(key: string): string | null {
  if (!isStoreMode()) return localStorage.getItem(key)
  return store.get(key) ?? null
}

export function kvSet(key: string, value: string): void {
  if (!isStoreMode()) {
    localStorage.setItem(key, value)
    return
  }
  store.set(key, value)
  const s = getState(key)
  s.seq += 1
  s.pending = { op: 'put', value }
  if (s.debounceTimer !== null) clearTimeout(s.debounceTimer)
  s.debounceTimer = setTimeout(() => {
    s.debounceTimer = null
    maybeSend(key)
  }, DEBOUNCE_MS)
}

export function kvRemove(key: string): void {
  if (!isStoreMode()) {
    localStorage.removeItem(key)
    return
  }
  store.delete(key)
  const s = getState(key)
  s.seq += 1
  s.pending = { op: 'del' }
  if (s.debounceTimer !== null) clearTimeout(s.debounceTimer)
  s.debounceTimer = setTimeout(() => {
    s.debounceTimer = null
    maybeSend(key)
  }, DEBOUNCE_MS)
}

function maybeSend(key: string): void {
  const s = getState(key)
  if (s.inFlight !== null || s.pending === null) return
  const op = s.pending
  s.pending = null
  s.inFlight = doSend(key, op).finally(() => {
    s.inFlight = null
    if (s.pending !== null) {
      const next = s.pending
      s.pending = null
      s.inFlight = doSend(key, next).finally(() => {
        s.inFlight = null
      })
    }
  })
}

function doSend(key: string, op: PendingOp): Promise<void> {
  const s = getState(key)
  const url = `/_store/${encodeURIComponent(key)}`
  const headers: Record<string, string> = {
    'X-DocuTeach-Token': _token,
    'Content-Type': 'application/json'
  }
  const body = op.op === 'put'
    ? JSON.stringify({ value: op.value, seq: s.seq })
    : JSON.stringify({ seq: s.seq })
  const method = op.op === 'put' ? 'PUT' : 'DELETE'

  return new Promise<void>((resolve) => {
    let attempt = 0
    const trySend = async (): Promise<void> => {
      try {
        const res = await fetch(url, { method, headers, body })
        if (res.status === 409) { resolve(); return }
        if (res.ok) { resolve(); return }
        throw new Error(`HTTP ${res.status}`)
      } catch (e) {
        attempt += 1
        if (attempt > RETRY_DELAYS.length) {
          const msg = e instanceof Error ? e.message : String(e)
          window.dispatchEvent(new CustomEvent('docuteach:save-error', {
            detail: `kv save failed for "${key}": ${msg}`
          }))
          resolve()
          return
        }
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]))
        await trySend()
      }
    }
    void trySend()
  })
}

declare global {
  interface Window {
    __docuteachFlush: () => Promise<void>
    __docuteachFlushed: boolean
  }
}

window.__docuteachFlushed = false

window.__docuteachFlush = (): Promise<void> => {
  window.__docuteachFlushed = false
  const promises: Promise<void>[] = []
  for (const [key, s] of keyStates) {
    if (s.debounceTimer !== null) {
      clearTimeout(s.debounceTimer)
      s.debounceTimer = null
    }
    if (s.pending !== null && s.inFlight === null) {
      const op = s.pending
      s.pending = null
      s.inFlight = doSend(key, op).finally(() => {
        s.inFlight = null
      })
    }
    if (s.inFlight !== null) promises.push(s.inFlight)
  }
  return Promise.all(promises).then(() => {
    window.__docuteachFlushed = true
  })
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void window.__docuteachFlush()
  }
})
window.addEventListener('pagehide', () => {
  void window.__docuteachFlush()
})
