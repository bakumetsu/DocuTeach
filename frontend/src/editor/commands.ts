import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection, NodeSelection } from '@tiptap/pm/state'

/**
 * Wraps a discrete editing action so it becomes exactly one undo step.
 * Dispatches closeHistory before and after `fn` runs.
 * `fn` must build and dispatch exactly ONE transaction via `editor.view.dispatch(tr)`.
 */
export function step(editor: Editor, fn: () => void): void {
  editor.view.dispatch(closeHistory(editor.state.tr))
  fn()
  editor.view.dispatch(closeHistory(editor.state.tr))
}

/**
 * Insert a teacher note.
 * - If the selection's top-level block is an empty paragraph, replace it.
 * - Otherwise insert after the current top-level block (or at doc end if depth 0).
 * Caret is placed inside the note's paragraph.
 */
export function insertTeacherNote(editor: Editor): void {
  step(editor, () => {
    const { state } = editor
    const { $from } = state.selection
    const doc = state.doc
    const { schema } = editor

    const note = schema.nodes.teacherNote.create({ tag: '' }, [
      schema.nodes.paragraph.create(),
    ])

    let notePos: number
    let tr

    if ($from.depth >= 1) {
      const topLevelStart = $from.before(1)
      const topLevelEnd = $from.after(1)
      const topLevelNode = doc.nodeAt(topLevelStart)

      if (
        topLevelNode &&
        topLevelNode.type.name === 'paragraph' &&
        topLevelNode.content.size === 0
      ) {
        notePos = topLevelStart
        tr = state.tr.replaceWith(topLevelStart, topLevelEnd, note)
      } else {
        notePos = topLevelEnd
        tr = state.tr.insert(topLevelEnd, note)
      }
    } else {
      notePos = doc.content.size
      tr = state.tr.insert(doc.content.size, note)
    }

    // teacherNote(pos) > paragraph(pos+1) > text(pos+2)
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(notePos + 2)))
    editor.view.dispatch(tr)
  })
}

/**
 * Insert an MCQ block (question + 3 empty options, multi: false).
 * Same placement rule as insertTeacherNote. Caret in the question.
 */
export function insertMcq(editor: Editor): void {
  step(editor, () => {
    const { state } = editor
    const { $from } = state.selection
    const doc = state.doc
    const { schema } = editor

    const mcq = schema.nodes.mcq.create(
      { multi: false },
      [
        schema.nodes.mcqQuestion.create(),
        schema.nodes.mcqOption.create({ correct: false }),
        schema.nodes.mcqOption.create({ correct: false }),
        schema.nodes.mcqOption.create({ correct: false }),
      ],
    )

    let mcqPos: number
    let tr

    if ($from.depth >= 1) {
      const topLevelStart = $from.before(1)
      const topLevelEnd = $from.after(1)
      const topLevelNode = doc.nodeAt(topLevelStart)

      if (
        topLevelNode &&
        topLevelNode.type.name === 'paragraph' &&
        topLevelNode.content.size === 0
      ) {
        mcqPos = topLevelStart
        tr = state.tr.replaceWith(topLevelStart, topLevelEnd, mcq)
      } else {
        mcqPos = topLevelEnd
        tr = state.tr.insert(topLevelEnd, mcq)
      }
    } else {
      mcqPos = doc.content.size
      tr = state.tr.insert(doc.content.size, mcq)
    }

    // mcq(pos) > mcqQuestion(pos+1) > text(pos+2)
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(mcqPos + 2)))
    editor.view.dispatch(tr)
  })
}

/**
 * Insert a blank node.
 * - If the selection is a non-empty TextSelection inside one textblock containing
 *   only plain text, replace it with a blank whose answers = [trimmed text].
 * - Otherwise insert an empty blank at the cursor.
 * Returns the document position of the inserted blank node.
 */
export function insertBlank(editor: Editor): number {
  let blankPos = 0
  step(editor, () => {
    const { state } = editor
    const sel = state.selection
    const doc = state.doc
    const { schema } = editor

    let tr

    const isTextSel =
      sel instanceof TextSelection &&
      sel.from !== sel.to &&
      sel.$from.parent === sel.$to.parent &&
      sel.$from.depth >= 1

    if (isTextSel) {
      // Verify the selected range contains only text (no inline nodes)
      const slice = doc.slice(sel.from, sel.to)
      let allText = true
      slice.content.forEach((node) => {
        if (!node.isText) allText = false
      })

      if (allText) {
        const selectedText = doc.textBetween(sel.from, sel.to).trim()
        const answers = selectedText ? [selectedText] : []
        blankPos = sel.from
        tr = state.tr.replaceWith(
          sel.from,
          sel.to,
          schema.nodes.blank.create({ answers }),
        )
      } else {
        blankPos = sel.from
        tr = state.tr.insert(
          sel.from,
          schema.nodes.blank.create({ answers: [] }),
        )
      }
    } else {
      blankPos = sel.from
      tr = state.tr.insert(
        sel.from,
        schema.nodes.blank.create({ answers: [] }),
      )
    }

    editor.view.dispatch(tr)
  })
  return blankPos
}

/**
 * Insert a split point, or select an existing one.
 * Returns 'inserted' if a new splitPoint was added, 'selected' if an existing one was found.
 */
export function insertSplitPoint(editor: Editor): 'inserted' | 'selected' {
  let result: 'inserted' | 'selected' = 'inserted'

  step(editor, () => {
    const { state } = editor
    const { $from } = state.selection
    const doc = state.doc
    const { schema } = editor

    // Search for an existing splitPoint
    let existingPos = -1
    doc.descendants((node, pos) => {
      if (node.type.name === 'splitPoint') {
        existingPos = pos
        return false
      }
      return true
    })

    if (existingPos !== -1) {
      result = 'selected'
      const tr = state
        .tr
        .setSelection(NodeSelection.create(doc, existingPos))
        .scrollIntoView()
      editor.view.dispatch(tr)
    } else {
      result = 'inserted'
      const split = schema.nodes.splitPoint.create({
        label: 'Homework starts here',
      })
      let tr
      if ($from.depth >= 1) {
        const topLevelEnd = $from.after(1)
        tr = state.tr.insert(topLevelEnd, split)
      } else {
        tr = state.tr.insert(doc.content.size, split)
      }
      editor.view.dispatch(tr)
    }
  })

  return result
}

/**
 * Set the answers attribute on a blank node at the given position.
 * Trims each answer and drops empty strings.
 */
export function setBlankAnswers(
  editor: Editor,
  pos: number,
  answers: string[],
): void {
  step(editor, () => {
    const trimmed = answers.map((a) => a.trim()).filter((a) => a.length > 0)
    const tr = editor
      .state.tr
      .setNodeMarkup(pos, undefined, { answers: trimmed })
    editor.view.dispatch(tr)
  })
}

/**
 * Replace a blank node with its first answer as plain text,
 * or delete it if there are no answers.
 */
export function blankToText(editor: Editor, pos: number): void {
  step(editor, () => {
    const doc = editor.state.doc
    const node = doc.nodeAt(pos)
    if (!node || node.type.name !== 'blank') return

    const answers: string[] = (node.attrs as { answers: string[] }).answers
    const first = answers[0]

    const tr = editor.state.tr
    if (first) {
      tr.replaceWith(pos, pos + 1, editor.schema.text(first))
    } else {
      tr.delete(pos, pos + 1)
    }
    editor.view.dispatch(tr)
  })
}

/**
 * Toggle the `correct` attribute on an mcqOption and recompute
 * the parent mcq's `multi` attribute (true when >1 option is correct).
 */
export function toggleCorrect(editor: Editor, optionPos: number): void {
  step(editor, () => {
    const doc = editor.state.doc
    const optionNode = doc.nodeAt(optionPos)
    if (!optionNode || optionNode.type.name !== 'mcqOption') return

    const newCorrect = !(optionNode.attrs as { correct: boolean }).correct
    const tr = editor.state.tr

    // Flip the option's correct attr
    tr.setNodeMarkup(optionPos, undefined, {
      ...(optionNode.attrs as object),
      correct: newCorrect,
    })

    // Recompute multi on the parent mcq
    const $pos = doc.resolve(optionPos)
    const mcqPos = $pos.before(1)
    const mcqNode = doc.nodeAt(mcqPos)

    if (mcqNode && mcqNode.type.name === 'mcq') {
      let originalCorrect = 0
      mcqNode.forEach((child) => {
        if (
          child.type.name === 'mcqOption' &&
          (child.attrs as { correct: boolean }).correct
        ) {
          originalCorrect++
        }
      })
      const newCorrectCount = newCorrect
        ? originalCorrect + 1
        : originalCorrect - 1
      tr.setNodeMarkup(mcqPos, undefined, {
        ...(mcqNode.attrs as object),
        multi: newCorrectCount > 1,
      })
    }

    editor.view.dispatch(tr)
  })
}

/**
 * Set the tag attribute on a teacherNote node.
 */
export function setNoteTag(editor: Editor, pos: number, tag: string): void {
  step(editor, () => {
    const tr = editor
      .state.tr
      .setNodeMarkup(pos, undefined, { tag })
    editor.view.dispatch(tr)
  })
}
