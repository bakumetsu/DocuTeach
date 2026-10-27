import type {
  DocuTeachApi,
  ChatRecord,
  ModelInfo,
  ModelState,
  SkillInfo,
  ChatRequest,
  StreamEvent,
} from '../types'
import { mockDocs } from './docs'

const CHATS_PREFIX = 'docuteach:v1:chats:'

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const mockApi: DocuTeachApi = {
  models: {
    list(): Promise<ModelInfo[]> {
      return Promise.resolve([])
    },
    current(): Promise<string | null> {
      return Promise.resolve(null)
    },
    select(id: string): Promise<ModelState> {
      return Promise.resolve({ id, status: 'ready' })
    },
  },
  chat: {
    async *stream(_req: ChatRequest, _signal: AbortSignal): AsyncIterable<StreamEvent> {
      yield { type: 'done' }
    },
  },
  chats: {
    load(docId: string): Promise<ChatRecord[]> {
      return Promise.resolve(readJson<ChatRecord[]>(CHATS_PREFIX + docId) ?? [])
    },
    save(docId: string, chats: ChatRecord[]): Promise<void> {
      localStorage.setItem(CHATS_PREFIX + docId, JSON.stringify(chats))
      return Promise.resolve()
    },
    release(_chatId: string): Promise<void> {
      return Promise.resolve()
    },
  },
  skills: {
    list(): Promise<SkillInfo[]> {
      return Promise.resolve([])
    },
  },
  docs: mockDocs,
}
