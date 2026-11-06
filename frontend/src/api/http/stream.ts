import { ApiError } from '../types'
import type { StreamEvent, DocuTeachApi, ContextInfo } from '../types'
import { request, rawFetch, requestBlob, enc } from './client'
import { parseContentDisposition } from './export'

export const httpModels: DocuTeachApi['models'] = {
  list: () => request('GET', '/models'),
  current: () => request<string | null>('GET', '/models/current'),
  select: (id, signal) => request('POST', '/models/select', { body: { id }, signal }),
  context: (id) => request<ContextInfo>('GET', `/models/${enc(id)}/context`),
  manage: () => request('GET', '/models/manage'),
  setDefault: (id) => request('POST', '/models/default', { body: { id } }),
  unload: (id) => request('POST', '/models/unload', { body: id ? { id } : {} }),
  customGet: (id) => request('GET', `/models/custom/${enc(id)}`),
  customPreview: (form) => request('POST', '/models/custom/preview', { body: form }),
  customAdd: (form) => request('POST', '/models/custom', { body: form }),
  customEdit: (id, form) => request('PUT', `/models/custom/${enc(id)}`, { body: form }),
  customRemove: (id) => request('DELETE', `/models/custom/${enc(id)}`),
  customUndo: () => request('POST', '/models/custom/undo'),
  setServerPath: (path) => request('POST', '/models/server-path', { body: { path } }),
}

const slugOf = (command: string): string => enc(command.replace(/^\//, ''))

export const httpSkills: DocuTeachApi['skills'] = {
  list: () => request('GET', '/skills'),
  manage: () => request('GET', '/skills/manage'),
  save: (draft) => request('POST', '/skills', { body: draft }),
  importPreview: (text) => request('POST', '/skills/import/preview', { body: { text } }),
  importCommit: (text, onClash, command) =>
    request('POST', '/skills/import/commit', { body: { text, onClash, command } }),
  remove: (command) => request('DELETE', `/skills/${slugOf(command)}`),
  restore: (trashId) => request('POST', `/skills/trash/${enc(trashId)}/restore`),
  reset: (command) => request('POST', `/skills/${slugOf(command)}/reset`),
  restoreDefaults: () => request('POST', '/skills/restore-defaults'),
  exportFile: async (command) => {
    const { blob, headers } = await requestBlob('GET', `/skills/${slugOf(command)}/file`)
    return {
      blob,
      filename: parseContentDisposition(headers.get('Content-Disposition')) ?? `${slugOf(command)}.md`,
    }
  },
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
    case 'edit':
      return typeof o.opId === 'string'
        && (o.kind === 'replace' || o.kind === 'insert' || o.kind === 'delete' || o.kind === 'move')
        && Array.isArray(o.targets) && o.targets.every((t) => typeof t === 'string')
        && Array.isArray(o.flags) && o.flags.every((f) => typeof f === 'string')
        && (o.anchor == null || typeof o.anchor === 'string')
        && (o.side == null || o.side === 'before' || o.side === 'after')
        && (o.markdown == null || typeof o.markdown === 'string')
    case 'edit_skipped':
      return typeof o.code === 'string' && typeof o.header === 'string'
    case 'done':
      if (o.fallback != null) return o.fallback === 'text'
      if (o.edits != null && typeof o.edits !== 'number') return false
      if (o.skipped != null && typeof o.skipped !== 'number') return false
      if (o.noChange != null && typeof o.noChange !== 'number') return false
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
