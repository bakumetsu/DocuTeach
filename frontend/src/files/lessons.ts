import { api } from '../api'
import { useApp } from '../state/store'
import { docToMarkdown, replaceDocument } from '../editor/docio'
import { isStoreMode } from '../api/kv'
import { loadJson, saveJson } from '../state/persist'
import { flushAutosave } from './autosave'
import { openFile } from './fileio'
import { useChats } from '../assistant/chatStore'
import type { LessonInfo } from '../api/types'

export async function bootstrapLesson(): Promise<void> {
  if (!isStoreMode()) return
  const list = await api.lessons.list()
  const last = loadJson<string>('lastLesson', '')
  let target = list.find((l) => l.id === last) ?? list[0]
  if (!target) {
    target = await api.lessons.create()
  }
  const s = useApp.getState()
  s.setLessonId(target.id)
  s.setLessonTitle(target.title)
  saveJson('lastLesson', target.id)
}

export async function openLesson(id: string, info?: LessonInfo): Promise<void> {
  const editor = useApp.getState().editor
  if (!editor) return

  try {
    await flushAutosave(editor)
  } catch {
    // lesson may have been deleted – ignore
  }

  const leaving = useApp.getState().lessonId
  const md = docToMarkdown(editor)
  if (md.trim() !== '' && leaving !== id) {
    try {
      await api.docs.checkpoints.create(leaving, 'Before open', md)
    } catch {
      // lesson may be gone – ignore
    }
  }

  useChats.getState().abortAll()

  const title =
    info?.title ??
    (await api.lessons.list()).find((l) => l.id === id)?.title ??
    ''

  const rec = await api.docs.load(id)

  const s = useApp.getState()
  s.setLessonId(id)
  s.setLessonTitle(title)
  s.setFileName(title ? title + '.md' : 'lesson.md')

  const warnings = replaceDocument(editor, rec?.markdown ?? '# New lesson\n')
  s.setWarnings(warnings)
  s.setDirty(false)
  s.setSaveState({ kind: 'idle' })

  saveJson('lastLesson', id)

  await useChats.getState().init()
}

export async function createLesson(title?: string): Promise<void> {
  const info = await api.lessons.create(title)
  await openLesson(info.id, info)
}

export async function renameLesson(id: string, title: string): Promise<LessonInfo> {
  const info = await api.lessons.rename(id, title)
  if (id === useApp.getState().lessonId) {
    const s = useApp.getState()
    s.setLessonTitle(info.title)
    s.setFileName(info.title + '.md')
  }
  return info
}

export async function deleteLesson(id: string): Promise<void> {
  await api.lessons.remove(id)
  if (id === useApp.getState().lessonId) {
    const rest = await api.lessons.list()
    if (rest.length > 0) {
      await openLesson(rest[0].id, rest[0])
    } else {
      await createLesson()
    }
  }
}

export async function restoreLesson(id: string): Promise<LessonInfo> {
  return api.lessons.restore(id)
}

export async function importMarkdownAsLesson(): Promise<boolean> {
  const opened = await openFile()
  if (!opened) return false
  const title = opened.name.replace(/\.md$/i, '')
  const info = await api.lessons.create(title)
  await api.docs.save(info.id, opened.text)
  await openLesson(info.id, info)
  return true
}
