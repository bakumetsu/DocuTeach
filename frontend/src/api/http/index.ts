import { request, enc } from './client'
import { mockApi } from '../mock'
import { ApiError } from '../types'
import type {
  DocuTeachApi,
  LessonInfo,
  DocRecord,
  Checkpoint,
  ChatRecord,
  ApiStatus,
} from '../types'

export const httpApi: DocuTeachApi = {
  lessons: {
    list: () => request<LessonInfo[]>('GET', '/lessons'),
    create: (title) => request<LessonInfo>('POST', '/lessons', { body: { title } }),
    rename: (id, title) => request<LessonInfo>('PATCH', `/lessons/${enc(id)}`, { body: { title } }),
    remove: (id) => request<void>('DELETE', `/lessons/${enc(id)}`),
    restore: (id) => request<LessonInfo>('POST', `/lessons/${enc(id)}/restore`),
  },
  docs: {
    load: async (id) => {
      try {
        return await request<DocRecord>('GET', `/lessons/${enc(id)}/doc`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    save: (id, markdown) =>
      request<DocRecord>('PUT', `/lessons/${enc(id)}/doc`, { body: { markdown } }),
    checkpoints: {
      list: (id) => request<Checkpoint[]>('GET', `/lessons/${enc(id)}/checkpoints`),
      create: (id, name, markdown, opts) =>
        request<Checkpoint>('POST', `/lessons/${enc(id)}/checkpoints`, {
          body: { name, markdown, auto: opts?.auto ?? false },
        }),
      remove: (id, cid) =>
        request<void>('DELETE', `/lessons/${enc(id)}/checkpoints/${enc(cid)}`),
      restore: (id, cid) =>
        request<Checkpoint>('POST', `/lessons/${enc(id)}/checkpoints/${enc(cid)}/restore`),
    },
  },
  chats: {
    load: (id) => request<ChatRecord[]>('GET', `/lessons/${enc(id)}/chats`),
    save: (id, chats) => request<void>('PUT', `/lessons/${enc(id)}/chats`, { body: chats }),
    release: (chatId) => mockApi.chats.release(chatId),
  },
  status: async () => {
    try {
      return await request<ApiStatus>('GET', '/status')
    } catch {
      return { llm: 'offline', model: null, version: '' }
    }
  },
  // tickets 8 and 9 replace these with real backend routes
  models: mockApi.models,
  chat: mockApi.chat,
  skills: mockApi.skills,
}
