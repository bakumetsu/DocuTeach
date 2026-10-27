import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'

function findAncestorDepth(
  $pos: { depth: number; node: (d: number) => { type: { name: string } } },
  name: string,
): number {
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).type.name === name) return d
  }
  return -1
}

function findAncestorPos(
  $pos: { depth: number; node: (d: number) => { type: { name: string } }; before: (d: number) => number },
  name: string,
): number {
  const depth = findAncestorDepth($pos, name)
  return depth === -1 ? -1 : $pos.before(depth)
}

export const EditorKeymaps = Extension.create({
  name: 'docuteachKeymaps',

  addKeyboardShortcuts() {
    return {
      // ── Enter inside an mcqOption: add a new option after the current one ──
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection

        // Check mcqOption first
        const optDepth = findAncestorDepth($from, 'mcqOption')
        if (optDepth !== -1) {
          const optionEnd = $from.after(optDepth)
          const newOption = editor.schema.nodes.mcqOption.create({ correct: false })
          const tr = editor.state.tr
          tr.insert(optionEnd, newOption)
          // mcqOption is a textblock: content pos = optionEnd + 1
          tr.setSelection(TextSelection.near(tr.doc.resolve(optionEnd + 1)))
          editor.view.dispatch(closeHistory(editor.state.tr))
          editor.view.dispatch(tr)
          editor.view.dispatch(closeHistory(editor.state.tr))
          return true
        }

        // Check teacherNote: Enter in EMPTY LAST paragraph of a note with ≥2 children
        const noteDepth = findAncestorDepth($from, 'teacherNote')
        if (noteDepth !== -1) {
          const notePos = $from.before(noteDepth)
          const noteNode = editor.state.doc.nodeAt(notePos)
          if (!noteNode) return false

          // Must be in the last child
          const lastChildPos = $from.before(noteDepth + 1)
          if (lastChildPos !== $from.before($from.depth)) return false

          // Must be empty
          if ($from.parent.content.size !== 0) return false
          // Must be the LAST child
          const childIndex = $from.index(noteDepth + 1)
          if (childIndex !== noteNode.childCount - 1) return false
          // Must have at least one OTHER child (i.e., total children >= 2)
          if (noteNode.childCount < 2) return false

          // Remove the last paragraph and insert an empty paragraph after the note
          const tr = editor.state.tr
          // Delete the last paragraph (it's empty so just remove the node)
          const lastParaStart = $from.before(noteDepth + 1)
          const lastParaEnd = $from.after(noteDepth + 1)
          tr.delete(lastParaStart, lastParaEnd)
          // Now the note ends at lastParaStart (shifted)
          // Insert empty paragraph after the note
          const newNoteEnd = lastParaStart // note now ends where the paragraph started
          tr.insert(newNoteEnd, editor.schema.nodes.paragraph.create())
          // paragraph is a textblock: content pos = newNoteEnd + 1
          tr.setSelection(TextSelection.near(tr.doc.resolve(newNoteEnd + 1)))

          editor.view.dispatch(closeHistory(editor.state.tr))
          editor.view.dispatch(tr)
          editor.view.dispatch(closeHistory(editor.state.tr))
          return true
        }

        return false
      },

      // ── Backspace: handle mcqOption and teacherNote cases ──
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from } = state.selection
        const { parent } = $from

        // Case 1: at start of an EMPTY mcqOption
        if (
          parent.type.name === 'mcqOption' &&
          $from.pos === $from.after($from.depth) &&
          parent.content.size === 0
        ) {
          const optDepth = $from.depth
          const optionPos = $from.before(optDepth)
          const optionEnd = $from.after(optDepth)

          const mcqPos = findAncestorPos($from, 'mcq')
          if (mcqPos === -1) return false
          const mcqNode = state.doc.nodeAt(mcqPos)
          if (!mcqNode) return false

          let optCount = 0
          mcqNode.forEach((child) => {
            if (child.type.name === 'mcqOption') optCount++
          })

          if (optCount > 2) {
            const tr = state.tr
            tr.delete(optionPos, optionEnd)
            // Caret at end of previous option = optionPos (where the deleted option started)
            tr.setSelection(TextSelection.near(tr.doc.resolve(optionPos)))
            editor.view.dispatch(closeHistory(state.tr))
            editor.view.dispatch(tr)
            editor.view.dispatch(closeHistory(editor.state.tr))
          }
          // With exactly 2 options: swallow the key (return true) to prevent structure break
          return true
        }

        // Case 2: Backspace in a teacherNote whose ONLY child is an empty paragraph
        if (parent.type.name === 'paragraph') {
          const noteDepth = findAncestorDepth($from, 'teacherNote')
          if (noteDepth !== -1) {
            const notePos = $from.before(noteDepth)
            const noteNode = state.doc.nodeAt(notePos)
            if (!noteNode) return false

            // Only one child and it's an empty paragraph
            if (
              noteNode.childCount === 1 &&
              $from.parent.content.size === 0
            ) {
              const noteEnd = $from.after(noteDepth)
              const tr = state.tr
              tr.delete(notePos, noteEnd)
              // Place caret in previous or next block
              const newDoc = tr.doc
              const target = Math.min(notePos, newDoc.content.size)
              const $target = newDoc.resolve(target)
              let caretPos = target
              if ($target.parent.isTextblock) {
                caretPos = $target.start()
              }
              tr.setSelection(TextSelection.near(tr.doc.resolve(caretPos)))
              editor.view.dispatch(closeHistory(state.tr))
              editor.view.dispatch(tr)
              editor.view.dispatch(closeHistory(editor.state.tr))
              return true
            }
          }
        }

        return false
      },

      // ── Mod-Enter inside an mcqOption: toggle correct ──
      'Mod-Enter': ({ editor }) => {
        const { $from } = editor.state.selection
        const optDepth = findAncestorDepth($from, 'mcqOption')
        if (optDepth === -1) return false

        const optionPos = $from.before(optDepth)
        const optionNode = editor.state.doc.nodeAt(optionPos)
        if (!optionNode || optionNode.type.name !== 'mcqOption') return false

        const newCorrect = !(optionNode.attrs as { correct: boolean }).correct
        const tr = editor.state.tr
        tr.setNodeMarkup(optionPos, undefined, {
          ...(optionNode.attrs as object),
          correct: newCorrect,
        })

        // Recompute multi
        const mcqPos = findAncestorPos($from, 'mcq')
        if (mcqPos !== -1) {
          const mcqNode = editor.state.doc.nodeAt(mcqPos)
          if (mcqNode && mcqNode.type.name === 'mcq') {
            let origCorrect = 0
            mcqNode.forEach((child) => {
              if (
                child.type.name === 'mcqOption' &&
                (child.attrs as { correct: boolean }).correct
              ) {
                origCorrect++
              }
            })
            const newCount = newCorrect ? origCorrect + 1 : origCorrect - 1
            tr.setNodeMarkup(mcqPos, undefined, {
              ...(mcqNode.attrs as object),
              multi: newCount > 1,
            })
          }
        }

        editor.view.dispatch(closeHistory(editor.state.tr))
        editor.view.dispatch(tr)
        editor.view.dispatch(closeHistory(editor.state.tr))
        return true
      },
    }
  },
})
