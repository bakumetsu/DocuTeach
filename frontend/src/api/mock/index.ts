import type {
  DocuTeachApi,
  DocRecord,
  Checkpoint,
  ChatRecord,
  ModelInfo,
  ModelState,
  SkillInfo,
  ChatRequest,
  StreamEvent,
} from '../types'

const DOC_PREFIX = 'docuteach:v1:doc:'
const CKPT_PREFIX = 'docuteach:v1:ckpt:'
const CHATS_PREFIX = 'docuteach:v1:chats:'
const CKPT_CAP = 50

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
  docs: {
    load(id: string): Promise<DocRecord | null> {
      return Promise.resolve(readJson<DocRecord>(DOC_PREFIX + id))
    },
    save(id: string, markdown: string): Promise<DocRecord> {
      const record: DocRecord = { id, markdown, updatedAt: new Date().toISOString() }
      localStorage.setItem(DOC_PREFIX + id, JSON.stringify(record))
      return Promise.resolve(record)
    },
    checkpoints: {
      list(id: string): Promise<Checkpoint[]> {
        return Promise.resolve(readJson<Checkpoint[]>(CKPT_PREFIX + id) ?? [])
      },
      create(id: string, name: string, markdown: string): Promise<Checkpoint> {
        const existing = readJson<Checkpoint[]>(CKPT_PREFIX + id) ?? []
        const cp: Checkpoint = {
          id: crypto.randomUUID(),
          name,
          createdAt: new Date().toISOString(),
          markdown,
        }
        const next = [...existing, cp].slice(-CKPT_CAP)
        localStorage.setItem(CKPT_PREFIX + id, JSON.stringify(next))
        return Promise.resolve(cp)
      },
      remove(id: string, checkpointId: string): Promise<void> {
        const existing = readJson<Checkpoint[]>(CKPT_PREFIX + id) ?? []
        const filtered = existing.filter((c) => c.id !== checkpointId)
        localStorage.setItem(CKPT_PREFIX + id, JSON.stringify(filtered))
        return Promise.resolve()
      },
    },
  },
}
