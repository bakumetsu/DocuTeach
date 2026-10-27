import type { Token } from 'markdown-it'
import type { Node as PMNode, Schema, Mark } from '@tiptap/pm/model'

/**
 * Convert the children of a markdown-it `inline` token into ProseMirror
 * inline nodes (text, hardBreak, blank).
 */
export function inlineToNodes(children: Token[] | null, schema: Schema): PMNode[] {
  if (!children || children.length === 0) return []

  const result: PMNode[] = []
  const activeMarks: Mark[] = []
  const spanStack: Mark[][] = []

  // --- helpers ---------------------------------------------------------

  function addMark(mark: Mark): void {
    activeMarks.push(mark)
  }

  function removeMarkByType(typeName: string): void {
    const idx = activeMarks.findIndex((m) => m.type.name === typeName)
    if (idx !== -1) activeMarks.splice(idx, 1)
  }

  function removeMarkByRef(mark: Mark): void {
    const idx = activeMarks.indexOf(mark)
    if (idx !== -1) activeMarks.splice(idx, 1)
  }

  /** Deduplicate active marks by type name (keeps first occurrence). */
  function dedupedMarks(): Mark[] {
    const seen = new Set<string>()
    const out: Mark[] = []
    for (const m of activeMarks) {
      if (!seen.has(m.type.name)) {
        seen.add(m.type.name)
        out.push(m)
      }
    }
    return out
  }

  // --- main loop -------------------------------------------------------

  for (const token of children) {
    switch (token.type) {
      case 'text': {
        if (token.content) {
          result.push(schema.text(token.content, dedupedMarks()))
        }
        break
      }

      case 'softbreak': {
        result.push(schema.text(' ', dedupedMarks()))
        break
      }

      case 'hardbreak': {
        result.push(schema.nodes.hardBreak.create())
        break
      }

      case 'strong_open': {
        addMark(schema.marks.bold.create())
        break
      }
      case 'strong_close': {
        removeMarkByType('bold')
        break
      }

      case 'em_open': {
        addMark(schema.marks.italic.create())
        break
      }
      case 'em_close': {
        removeMarkByType('italic')
        break
      }

      case 'mark_open': {
        addMark(schema.marks.highlight.create())
        break
      }
      case 'mark_close': {
        removeMarkByType('highlight')
        break
      }

      case 'span_open': {
        const classes: string[] = (token.meta as { classes?: string[] } | undefined)?.classes ?? []
        const marks: Mark[] = []
        for (const c of classes) {
          switch (c) {
            case 'u': marks.push(schema.marks.underline.create()); break
            case 'b': marks.push(schema.marks.bold.create()); break
            case 'i': marks.push(schema.marks.italic.create()); break
            case 'hl': marks.push(schema.marks.highlight.create()); break
          }
        }
        for (const m of marks) addMark(m)
        spanStack.push(marks)
        break
      }

      case 'span_close': {
        const marks = spanStack.pop() ?? []
        for (const m of marks) removeMarkByRef(m)
        break
      }

      case 'blank': {
        const answers: string[] = (token.meta as { answers?: string[] } | undefined)?.answers ?? []
        result.push(schema.nodes.blank.create({ answers }))
        break
      }

      default: {
        // code_inline, html_inline, image, etc.
        if (token.content) {
          result.push(schema.text(token.content, dedupedMarks()))
        }
        break
      }
    }
  }

  return result
}
