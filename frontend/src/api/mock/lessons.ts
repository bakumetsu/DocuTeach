import type { DocuTeachApi, LessonInfo, DocRecord } from '../types'
import { ApiError } from '../types'
import { kvGet, kvSet } from '../kv'

const LESSONS_KEY = 'docuteach:v1:lessons'
const TRASH_KEY = 'docuteach:v1:lessons-trash'
const DOC_PREFIX = 'docuteach:v1:doc:'

function readJson<T>(key: string): T | null {
  const raw = kvGet(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  kvSet(key, JSON.stringify(value))
}

export const mockLessons: DocuTeachApi['lessons'] = {
  async list(): Promise<LessonInfo[]> {
    const lessons = readJson<LessonInfo[]>(LESSONS_KEY) ?? []
    return [...lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  async create(title?: string): Promise<LessonInfo> {
    const ts = new Date().toISOString()
    const trimmed = title?.trim() || 'New lesson'
    const lesson: LessonInfo = {
      id: crypto.randomUUID(),
      title: trimmed,
      createdAt: ts,
      updatedAt: ts,
    }
    const lessons = readJson<LessonInfo[]>(LESSONS_KEY) ?? []
    writeJson(LESSONS_KEY, [...lessons, lesson])

    const doc: DocRecord = {
      id: lesson.id,
      markdown: `# ${trimmed}\n`,
      updatedAt: ts,
    }
    writeJson(DOC_PREFIX + lesson.id, doc)

    return lesson
  },

  async rename(id: string, title: string): Promise<LessonInfo> {
    const lessons = readJson<LessonInfo[]>(LESSONS_KEY) ?? []
    const idx = lessons.findIndex((l) => l.id === id)
    if (idx === -1) throw new ApiError('lesson_not_found', 404, 'Lesson not found')

    const updated: LessonInfo = {
      ...lessons[idx],
      title,
      updatedAt: new Date().toISOString(),
    }
    lessons[idx] = updated
    writeJson(LESSONS_KEY, lessons)
    return updated
  },

  async remove(id: string): Promise<void> {
    const lessons = readJson<LessonInfo[]>(LESSONS_KEY) ?? []
    const idx = lessons.findIndex((l) => l.id === id)
    if (idx === -1) throw new ApiError('lesson_not_found', 404, 'Lesson not found')

    const [lesson] = lessons.splice(idx, 1)
    writeJson(LESSONS_KEY, lessons)

    const trash = readJson<LessonInfo[]>(TRASH_KEY) ?? []
    writeJson(TRASH_KEY, [...trash, lesson])
  },

  async restore(id: string): Promise<LessonInfo> {
    const trash = readJson<LessonInfo[]>(TRASH_KEY) ?? []
    const idx = trash.findIndex((l) => l.id === id)
    if (idx === -1) throw new ApiError('lesson_not_found', 404, 'Lesson not found')

    const [lesson] = trash.splice(idx, 1)
    writeJson(TRASH_KEY, trash)

    const lessons = readJson<LessonInfo[]>(LESSONS_KEY) ?? []
    writeJson(LESSONS_KEY, [...lessons, lesson])

    return lesson
  },
}

export const mockStatus: DocuTeachApi['status'] = async () => ({
  llm: 'online',
  model: null,
  version: 'mock',
})
