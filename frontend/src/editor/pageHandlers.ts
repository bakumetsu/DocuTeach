import type { Editor } from '@tiptap/core'
import { setPageHandlers } from '../assistant/pageBridge'
import { setDraftCanceller } from './history'
import { startPageStream, cancelPageStream } from './stream'
import { insertFragment } from './insert'
import { useApp } from '../state/store'

export function installPageHandlers(editor: Editor): () => void {
  setPageHandlers({
    runSkill(r) {
      if (useApp.getState().view !== 'edit') return false
      const raw =
        r.selection ??
        editor.state.doc.textBetween(
          editor.state.selection.from,
          editor.state.selection.to,
          ' ',
        )
      const selection = raw || undefined
      return startPageStream(editor, { skill: r.skill, selection, prompt: r.prompt })
    },
    insertFragment(md) {
      return useApp.getState().view === 'edit' && insertFragment(editor, md, null).ok
    },
  })

  setDraftCanceller(() => cancelPageStream(editor))

  return () => {
    setPageHandlers({})
    setDraftCanceller(null)
  }
}
