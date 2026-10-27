import { mergeAttributes, type AnyExtension } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { extensions } from './extensions'
import { EditorKeymaps } from './keymaps'
import { SplitGuard } from './guards'
import { TeacherNoteView } from './nodeviews/TeacherNoteView'
import { BlankView } from './nodeviews/BlankView'
import { McqView, McqOptionView } from './nodeviews/McqView'
import { SplitView } from './nodeviews/SplitView'
import { RawView } from './nodeviews/RawView'

function getExtension(name: string): AnyExtension {
  const found = extensions.find((extension) => extension.name === name)
  if (!found) {
    throw new Error(`Missing editor extension: ${name}`)
  }
  return found
}

export function buildEditorExtensions(opts?: { onSplitBlocked?: () => void }): AnyExtension[] {
  const replacements: Record<string, AnyExtension> = {
    teacherNote: getExtension('teacherNote').extend({
      addNodeView: () => ReactNodeViewRenderer(TeacherNoteView),
    }),
    blank: getExtension('blank').extend({
      addNodeView: () => ReactNodeViewRenderer(BlankView),
    }),
    mcq: getExtension('mcq').extend({
      addNodeView: () => ReactNodeViewRenderer(McqView),
    }),
    mcqOption: getExtension('mcqOption').extend({
      addNodeView: () => ReactNodeViewRenderer(McqOptionView),
    }),
    splitPoint: getExtension('splitPoint').extend({
      addNodeView: () => ReactNodeViewRenderer(SplitView),
    }),
    rawBlock: getExtension('rawBlock').extend({
      addNodeView: () => ReactNodeViewRenderer(RawView),
    }),
    mcqQuestion: getExtension('mcqQuestion').extend({
      renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
        return [
          'p',
          mergeAttributes(HTMLAttributes, {
            class: 'mcq-question',
            'data-type': 'mcq-question',
          }),
          0,
        ]
      },
    }),
  }

  const result: AnyExtension[] = []

  for (const extension of extensions) {
    const replacement = replacements[extension.name]
    result.push(replacement ?? extension)
  }

  result.push(EditorKeymaps)
  result.push(SplitGuard.configure({ onBlocked: opts?.onSplitBlocked }))

  return result
}
