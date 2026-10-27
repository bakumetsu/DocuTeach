import type { Node as PMNode } from '@tiptap/pm/model'

export interface QuestionNumber {
  section: number
  n: number
  label: string
  pos: number
}

export function numberQuestions(doc: PMNode): QuestionNumber[] {
  const results: QuestionNumber[] = []
  let section = 0
  let n = 0
  let offset = 0

  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const childPos = offset

    if (child.type.name === 'heading' && (child.attrs.level as number) === 2) {
      section++
      n = 0
    }

    if (child.type.name === 'orderedList') {
      let itemOffset = childPos + 1
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (item.type.name === 'listItem') {
          n++
          results.push({
            section,
            n,
            label: section === 0 ? `${n}` : `${section}.${n}`,
            pos: itemOffset,
          })
        }
        itemOffset += item.nodeSize
      }
    } else if (child.type.name === 'mcq') {
      n++
      results.push({
        section,
        n,
        label: section === 0 ? `${n}` : `${section}.${n}`,
        pos: childPos,
      })
    }

    offset += child.nodeSize
  }

  return results
}
