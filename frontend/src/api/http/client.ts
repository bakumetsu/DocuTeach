import { ApiError } from '../types'

const token = document.querySelector('meta[name="docuteach-token"]')?.getAttribute('content') ?? ''

export function hasToken(): boolean {
  return token !== ''
}

export const enc = encodeURIComponent

export async function rawFetch(
  method: string,
  path: string,
  opts?: { body?: unknown; signal?: AbortSignal },
): Promise<Response> {
  const headers: Record<string, string> = { 'X-DocuTeach-Token': token }
  const hasBody = opts?.body !== undefined
  if (hasBody) {
    headers['Content-Type'] = 'application/json'
  }

  let res: Response
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts?.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new ApiError('network', 0, 'Cannot reach the DocuTeach backend')
  }

  if (!res.ok) {
    let code = 'http_error'
    let message = res.statusText
    try {
      const data = (await res.json()) as { code?: string; message?: string }
      if (data.code) code = data.code
      if (data.message) message = data.message
    } catch {
      // non-JSON error body; keep defaults
    }
    throw new ApiError(code, res.status, message)
  }

  return res
}

export async function request<T>(
  method: string,
  path: string,
  opts?: { body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const res = await rawFetch(method, path, opts)
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ApiError('bad_response', res.status, 'Invalid response from the backend')
    }
    throw err
  }
}

export async function requestBlob(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ blob: Blob; headers: Headers }> {
  const res = await rawFetch(method, path, body !== undefined ? { body } : undefined)
  const blob = await res.blob()
  return { blob, headers: res.headers }
}
