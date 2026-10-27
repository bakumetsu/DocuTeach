import type { DocuTeachApi, DocRecord, Checkpoint } from '../types'

const DOC_PREFIX = 'docuteach:v1:doc:'
const CKPT_PREFIX = 'docuteach:v1:ckpt:'
const CKPT_CAP = 50
const BEFORE_OPEN_NAME = 'Before open'

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function pruneCheckpoints(list: Checkpoint[]): Checkpoint[] {
  if (list.length <= CKPT_CAP) return list

  const exemptId = list.findLast((c) => c.name === BEFORE_OPEN_NAME)?.id
  const toRemove = list.length - CKPT_CAP
  const kept: Checkpoint[] = []
  let removed = 0

  for (const cp of list) {
    if (removed < toRemove && cp.id !== exemptId) {
      removed += 1
    } else {
      kept.push(cp)
    }
  }

  return kept
}

export const mockDocs: DocuTeachApi['docs'] = {
  async load(id: string): Promise<DocRecord | null> {
    return readJson<DocRecord>(DOC_PREFIX + id)
  },

  async save(id: string, markdown: string): Promise<DocRecord> {
    const record: DocRecord = {
      id,
      markdown,
      updatedAt: new Date().toISOString(),
    }
    writeJson(DOC_PREFIX + id, record)
    return record
  },

  checkpoints: {
    async list(id: string): Promise<Checkpoint[]> {
      const list = readJson<Checkpoint[]>(CKPT_PREFIX + id) ?? []
      return [...list].reverse()
    },

    async create(id: string, name: string, markdown: string): Promise<Checkpoint> {
      const existing = readJson<Checkpoint[]>(CKPT_PREFIX + id) ?? []
      const checkpoint: Checkpoint = {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        markdown,
      }
      const next = pruneCheckpoints([...existing, checkpoint])
      writeJson(CKPT_PREFIX + id, next)
      return checkpoint
    },

    async remove(id: string, checkpointId: string): Promise<void> {
      const existing = readJson<Checkpoint[]>(CKPT_PREFIX + id) ?? []
      const next = existing.filter((c) => c.id !== checkpointId)
      writeJson(CKPT_PREFIX + id, next)
    },
  },
}
