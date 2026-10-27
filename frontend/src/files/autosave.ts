import type { Editor } from '@tiptap/react'
import { api } from '../api'
import { useApp } from '../state/store'
import { docToMarkdown } from '../editor/docio'

interface AutosaveController {
  clear: () => void
  save: () => Promise<void>
}

const controllers = new WeakMap<Editor, AutosaveController>()

function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function startAutosave(editor: Editor, opts?: { delayMs?: number }): () => void {
  const delayMs = opts?.delayMs ?? 800
  let timer: ReturnType<typeof setTimeout> | null = null

  const save = async (): Promise<void> => {
    useApp.getState().setSaveState({ kind: 'saving' })
    try {
      await api.docs.save('draft', docToMarkdown(editor))
      useApp.getState().setSaveState({ kind: 'saved', at: formatTime(new Date()) })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      useApp.getState().setSaveState({ kind: 'error', reason })
    }
  }

  const handler = () => {
    useApp.getState().setDirty(true)
    useApp.getState().setSaveState({ kind: 'saving' })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void save()
    }, delayMs)
  }

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  controllers.set(editor, { clear, save })
  editor.on('update', handler)

  return () => {
    clear()
    editor.off('update', handler)
    controllers.delete(editor)
  }
}

export async function flushAutosave(editor: Editor): Promise<void> {
  const controller = controllers.get(editor)
  controller?.clear()
  if (controller) {
    await controller.save()
    return
  }

  useApp.getState().setSaveState({ kind: 'saving' })
  try {
    await api.docs.save('draft', docToMarkdown(editor))
    useApp.getState().setSaveState({ kind: 'saved', at: formatTime(new Date()) })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    useApp.getState().setSaveState({ kind: 'error', reason })
  }
}
