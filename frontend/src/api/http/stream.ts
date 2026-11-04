import { ApiError } from '../types'
import type { StreamEvent, DocuTeachApi, ContextInfo } from '../types'
import { request, rawFetch, enc } from './client'

export const httpModels: DocuTeachApi['models'] = {
  list: () => request('GET', '/models'),
  current: () => request<string | null>('GET', '/models/current'),
  select: (id, signal) => request('POST', '/models/select', { body: { id }, signal }),
  context: (id) => request<ContextInfo>('GET', `/models/${enc(id)}/context`),
}

export const httpSkills: DocuTeachApi['skills'] = {
  list: () => request('GET', '/skills'),
}

export async function releaseChat(chatId: string): Promise<void> {
  try {
    await request('POST', `/chats/${enc(chatId)}/release`)
  } catch {
    // best effort
  }
}

function isStreamEvent(x: unknown): x is StreamEvent {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  switch (o.type) {
    case 'status':
      return o.status === 'swapping' || o.status === 'generating' || o.status === 'thinking'
    case 'token':
      return typeof o.text === 'string'
    case 'structured':
      return (o.kind === 'teacherNote' || o.kind === 'blanks' || o.kind === 'text')
        && typeof o.markdown === 'string'
    case 'error':
      if (typeof o.message !== 'string') return false
      if (o.code != null) {
        return o.code === 'llm_offline' || o.code === 'llm_busy'
          || o.code === 'llm_timeout' || o.code === 'chat_busy'
      }
      return true
    case 'done':
      if (o.fallback != null) return o.fallback === 'text'
      return true
    default:
      return false
  }
}

export const httpChat: DocuTeachApi['chat'] = {
  async *stream(req, signal) {
    let res: Response
    try {
      res = await rawFetch('POST', '/chat/stream', { body: req, signal })
    } catch (err) {
      if (err instanceof ApiError) {
        let code: string | undefined
        let message: string
        if (err.code === 'chat_busy') {
          code = 'chat_busy'
          message = 'This chat is already answering. Wait for it or press Stop.'
        } else if (err.code === 'llm_offline' || err.code === 'network') {
          code = 'llm_offline'
          message = 'AI is offline'
        } else if (err.code === 'llm_busy') {
          code = 'llm_busy'
          message = 'AI is busy, try again in a moment'
        } else if (err.code === 'prompt_too_long') {
          message = err.message
        } else {
          message = err.message
        }
        yield { type: 'error', message, code } as StreamEvent
        return
      }
      throw err
    }

    if (!res.body) {
      yield { type: 'error', message: 'The model stopped unexpectedly' }
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawTerminal = false

    try {
      while (true) {
        let chunk: { done: boolean; value?: Uint8Array }
        try {
          chunk = await reader.read()
        } catch (err) {
          if (signal?.aborted) return
          throw err
        }
        if (chunk.done) break

        buffer += decoder.decode(chunk.value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''

        for (const line of parts) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(trimmed)
          } catch {
            continue
          }
          if (!isStreamEvent(parsed)) continue
          if (parsed.type === 'done' || parsed.type === 'error') sawTerminal = true
          yield parsed
        }
      }

      const trimmed = buffer.trim()
      if (trimmed) {
        try {
          const parsed: unknown = JSON.parse(trimmed)
          if (isStreamEvent(parsed)) {
            if (parsed.type === 'done' || parsed.type === 'error') sawTerminal = true
            yield parsed
          }
        } catch {
          // skip
        }
      }

      if (!sawTerminal && !signal?.aborted) {
        yield { type: 'error', message: 'The model stopped unexpectedly' } as StreamEvent
      }
    } finally {
      reader.cancel().catch(() => {})
    }
  },
}
