import type { Editor } from '@tiptap/core'
import { setPageHandlers } from '../assistant/pageBridge'
import { setDraftCanceller } from './history'
import { startPageStream, cancelPageStream } from './stream'
import { startPageEdit, cancelPageEdit } from './suggest/edit'
import { insertFragment } from './insert'
import { useApp } from '../state/store'
import { useEditEntry } from '../assistant/editEntry'

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
      return useApp.getState().view === 'edit' && insertFragment(editor, md, null, { checkpoint: 'Before AI: chat insert' }).ok
    },
    runEdit(r) {
      if (useApp.getState().view !== 'edit') return false
      return startPageEdit(editor, r)
    },
  })

  setDraftCanceller(() => cancelPageStream(editor) || cancelPageEdit(editor))

  const onSel = () => useEditEntry.getState().setHasSelection(!editor.state.selection.empty)
  editor.on('selectionUpdate', onSel)
  onSel()

  return () => {
    editor.off('selectionUpdate', onSel)
    setPageHandlers({})
    setDraftCanceller(null)
  }
}
