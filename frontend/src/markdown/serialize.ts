import type { Node as PMNode } from '@tiptap/pm/model'
import { serializeInline } from './serialize-inline'
import { serializeFrontMatter } from './frontmatter'
import type { Meta } from './frontmatter'
import { escapeTag } from './escape'

function blockToLines(node: PMNode): string {
  switch (node.type.name) {
    case 'paragraph':
      return serializeInline(node)
    case 'heading': {
      const level = (node.attrs as { level: number }).level
      let text = serializeInline(node, { lineStart: false })
      text = text.replace(/(^|\s)(#+)$/, (_m, prefix: string, hashes: string) => prefix + '\\' + hashes)
      return '#'.repeat(level) + ' ' + text
    }
    case 'bulletList':
      return serializeList(node, false)
    case 'orderedList':
      return serializeList(node, true)
    case 'teacherNote':
      return serializeTeacherNote(node)
    case 'mcq':
      return serializeMcq(node)
    case 'splitPoint':
      return `<!-- split: ${(node.attrs as { label: string }).label} -->`
    case 'rawBlock':
      return (node.attrs as { text: string }).text
    case 'table':
      return serializeTable(node)
    default:
      return node.textContent
  }
}

function serializeList(node: PMNode, ordered: boolean): string {
  const lines: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const item = node.child(i)
    const marker = ordered ? `${i + 1}. ` : '- '
    const indent = ordered ? '   ' : '  '

    const firstChild = item.child(0)
    const text = serializeInline(firstChild)
    const textLines = text.split('\n')

    lines.push(marker + textLines[0])
    for (let j = 1; j < textLines.length; j++) {
      lines.push(indent + textLines[j])
    }

    for (let j = 1; j < item.childCount; j++) {
      const child = item.child(j)
      if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
        const nested = serializeList(child, child.type.name === 'orderedList')
        const nestedLines = nested.split('\n')
        for (const nl of nestedLines) {
          lines.push(indent + nl)
        }
      }
    }
  }
  return lines.join('\n')
}

function serializeTeacherNote(node: PMNode): string {
  const tag = (node.attrs as { tag?: string | null }).tag
  const header = '::: teacher' + (tag ? ` {tag="${escapeTag(tag)}"}` : '')
  const children: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    children.push(blockToLines(node.child(i)))
  }
  return header + '\n' + children.join('\n\n') + '\n:::'
}

function serializeMcq(node: PMNode): string {
  const lines: string[] = []

  const question = node.child(0)
  const qText = serializeInline(question, { lineStart: false })
  if (qText !== '') {
    lines.push(qText)
  }

  for (let i = 1; i < node.childCount; i++) {
    const option = node.child(i)
    const correct = (option.attrs as { correct: boolean }).correct
    const text = serializeInline(option, { lineStart: false })
    lines.push(correct ? `- [x] ${text}` : `- [ ] ${text}`)
  }

  return lines.join('\n')
}

function serializeTable(node: PMNode): string {
  const lines: string[] = []
  let n = 0

  for (let i = 0; i < node.childCount; i++) {
    const row = node.child(i)
    if (i === 0) {
      n = row.childCount
    }
    const cells: string[] = []
    for (let j = 0; j < row.childCount; j++) {
      const cell = row.child(j)
      cells.push(serializeInline(cell.firstChild!, { cell: true, lineStart: false }))
    }
    lines.push('| ' + cells.join(' | ') + ' |')
    if (i === 0) {
      lines.push('| ' + Array(n).fill('---').join(' | ') + ' |')
    }
  }

  return lines.join('\n')
}

export function serializeMarkdown(doc: PMNode): string {
  const meta = doc.attrs.meta as Meta
  const fm = serializeFrontMatter(meta)

  const blocks: string[] = []
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (child.type.name === 'paragraph' && child.textContent === '') continue
    let block = blockToLines(child)
    if (
      (child.type.name === 'paragraph' || child.type.name === 'heading') &&
      child.attrs.align &&
      child.attrs.align !== 'left'
    ) {
      block = `::: {.${child.attrs.align}}\n${block}\n:::`
    }
    blocks.push(block)
  }

  if (blocks.length === 0) {
    if (fm === '') return ''
    return fm.replace(/\n+$/, '\n')
  }

  return fm + blocks.join('\n\n') + '\n'
}
