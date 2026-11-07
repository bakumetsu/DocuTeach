import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { parseMarkdown } from '../markdown/parse'
import { serializeMarkdown } from '../markdown/serialize'
import type { Meta } from '../markdown/frontmatter'

export function docToMarkdown(editor: Editor): string {
  return serializeMarkdown(editor.state.doc)
}

export function docJsonFromMarkdown(md: string): { json: object; warnings: string[] } {
  const { doc, warnings } = parseMarkdown(md)
  return { json: doc.toJSON() as object, warnings }
}

export function replaceDocument(editor: Editor, md: string): string[] {
  const { json, warnings } = docJsonFromMarkdown(md)
  const newDoc = editor.schema.nodeFromJSON(json)
  const tr = editor.state.tr
    .replaceWith(0, editor.state.doc.content.size, newDoc.content)
    .setDocAttribute('meta', newDoc.attrs.meta)
  tr.setSelection(Selection.atStart(tr.doc))
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.view.dispatch(tr)
  editor.view.dispatch(closeHistory(editor.state.tr))
  return warnings
}

export function setMeta(editor: Editor, meta: Meta): void {
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.view.dispatch(editor.state.tr.setDocAttribute('meta', meta))
  editor.view.dispatch(closeHistory(editor.state.tr))
}
