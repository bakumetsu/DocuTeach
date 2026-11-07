import type { Node as PMNode } from '@tiptap/pm/model'

export interface QuestionNumber {
  section: number
  n: number
  label: string
  pos: number
  textPos: number
  kind: 'item' | 'mcq' | 'paragraph'
  listPos?: number
}

/** True if the node's subtree contains a 'blank' node that is NOT inside a nested orderedList/bulletList. */
function hasBlankOutsideNestedLists(node: PMNode): boolean {
  let found = false
  node.descendants((child) => {
    if (child.type.name === 'blank') {
      found = true
      return false
    }
    if (
      child.type.name === 'orderedList' ||
      child.type.name === 'bulletList' ||
      child.type.name === 'teacherNote'
    ) {
      return false
    }
    return true
  })
  return found
}

/** True if the node's subtree contains a 'blank' node (never descending into teacherNote). */
function hasBlank(node: PMNode): boolean {
  let found = false
  node.descendants((child) => {
    if (child.type.name === 'blank') {
      found = true
      return false
    }
    if (child.type.name === 'teacherNote') {
      return false
    }
    return true
  })
  return found
}

/**
 * Returns the absolute doc position just inside the first textblock descendant of `node`,
 * or -1 if none exists. Never descends into teacherNote.
 */
function firstTextBlockPos(node: PMNode, nodeAbsPos: number): number {
  if (node.isTextblock) return nodeAbsPos + 1
  let childAbsPos = nodeAbsPos + 1
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child.type.name === 'teacherNote') {
      childAbsPos += child.nodeSize
      continue
    }
    if (child.isTextblock) return childAbsPos + 1
    const result = firstTextBlockPos(child, childAbsPos)
    if (result !== -1) return result
    childAbsPos += child.nodeSize
  }
  return -1
}

export function numberQuestions(doc: PMNode): QuestionNumber[] {
  const results: QuestionNumber[] = []
  let section = 0
  let n = 0
  let offset = 0

  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const childPos = offset

    // Reset at heading level 2
    if (child.type.name === 'heading' && (child.attrs.level as number) === 2) {
      section++
      n = 0
    }

    if (child.type.name === 'orderedList') {
      // Determine whether ANY direct listItem has a blank in its own content
      let hasAnyBlank = false
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (item.type.name === 'listItem' && hasBlankOutsideNestedLists(item)) {
          hasAnyBlank = true
          break
        }
      }

      if (hasAnyBlank) {
        let itemOffset = childPos + 1
        for (let j = 0; j < child.childCount; j++) {
          const item = child.child(j)
          if (item.type.name === 'listItem') {
            n++
            const textPos = firstTextBlockPos(item, itemOffset)
            results.push({
              section,
              n,
              label: String(n),
              pos: itemOffset,
              textPos,
              kind: 'item',
              listPos: childPos,
            })
          }
          itemOffset += item.nodeSize
        }
      }
    } else if (child.type.name === 'mcq') {
      n++
      const textPos = firstTextBlockPos(child, childPos)
      results.push({
        section,
        n,
        label: String(n),
        pos: childPos,
        textPos,
        kind: 'mcq',
      })
    } else if (child.type.name === 'paragraph') {
      if (hasBlank(child)) {
        n++
        results.push({
          section,
          n,
          label: String(n),
          pos: childPos,
          textPos: childPos + 1,
          kind: 'paragraph',
        })
      }
    }

    offset += child.nodeSize
  }

  return results
}
