import type { DocuTeachApi, ChatRecord, ChatRequest, StreamEvent } from '../types'
import { mockConfig, sleep } from './config'
import { setCurrentModel, getCurrentModel } from './models'
import { scriptFor, tokenize } from './script'

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

// --- Slot management ---

const slots = new Map<string, number>()

function assignSlot(chatId: string): void {
  const used = new Set(slots.values())
  let n = 0
  while (used.has(n)) n++
  slots.set(chatId, n)
}

function releaseSlot(chatId: string): void {
  slots.delete(chatId)
}

export function mockSlots(): ReadonlyMap<string, number> {
  return slots
}

// --- Chat stream ---

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export const mockChat: DocuTeachApi['chat'] = {
  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    assignSlot(req.chatId)
    try {
      if (req.model !== getCurrentModel()) {
        yield { type: 'status', status: 'swapping' }
        await sleep(mockConfig.swapMs, signal)
        if (req.model === 'broken-model') {
          yield { type: 'error', message: 'Could not load' }
          return
        }
        setCurrentModel(req.model)
      }

      yield { type: 'status', status: 'generating' }

      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
      const lastUserText = lastUserMsg?.content ?? ''

      if (lastUserText.includes('[fail]')) {
        yield { type: 'error', message: 'The assistant failed (test)' }
        return
      }

      const script = scriptFor(req.skill, lastUserText, req.selection)
      const tokens = tokenize(script.markdown)

      for (const token of tokens) {
        await sleep(randomBetween(mockConfig.tokenMinMs, mockConfig.tokenMaxMs), signal)
        yield { type: 'token', text: token }
      }

      if (script.kind && script.kind !== 'text') {
        yield { type: 'structured', kind: script.kind, markdown: script.markdown }
      }

      yield { type: 'done' }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return
      }
      throw e
    } finally {
      releaseSlot(req.chatId)
    }
  },
}

// --- Chats persistence ---

export const mockChats: DocuTeachApi['chats'] = {
  load(docId: string): Promise<ChatRecord[]> {
    return Promise.resolve(readJson<ChatRecord[]>(CHATS_PREFIX + docId) ?? [])
  },
  save(docId: string, chats: ChatRecord[]): Promise<void> {
    localStorage.setItem(CHATS_PREFIX + docId, JSON.stringify(chats))
    return Promise.resolve()
  },
  release(chatId: string): Promise<void> {
    releaseSlot(chatId)
    return Promise.resolve()
  },
}
