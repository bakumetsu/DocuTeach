import type { Node as PMNode } from '@tiptap/pm/model'
import { escapeInline, escapeLineStart, escapeAnswer, escapeCellPipes } from './escape'

const CANONICAL = ['underline', 'highlight', 'bold', 'italic'] as const
type MarkName = (typeof CANONICAL)[number]

interface TextLeaf { kind: 'text'; s: string; marks: MarkName[] }
interface BlankLeaf { kind: 'blank'; answers: string[] }
interface BrLeaf { kind: 'br' }
type Leaf = TextLeaf | BlankLeaf | BrLeaf

interface Group { kind: 'group'; mark: MarkName; items: Node[]; forceSpan?: boolean }
type Node = Leaf | Group

function markName(mark: { type: { name: string } }): MarkName | null {
  const n = mark.type.name
  return (CANONICAL as readonly string[]).includes(n) ? (n as MarkName) : null
}

function sortMarks(marks: MarkName[]): MarkName[] {
  return [...marks].sort((a, b) => CANONICAL.indexOf(a) - CANONICAL.indexOf(b))
}

function toEvents(parent: PMNode, cell: boolean): Leaf[] {
  const events: Leaf[] = []
  for (const child of parent.children ?? []) {
    if (child.type.name === 'text') {
      events.push({ kind: 'text', s: child.textContent ?? '', marks: sortMarks(child.marks.map(markName).filter(Boolean) as MarkName[]) })
    } else if (child.type.name === 'blank') {
      events.push({ kind: 'blank', answers: (child.attrs.answers ?? []) as string[] })
    } else if (child.type.name === 'hardBreak') {
      if (cell) events.push({ kind: 'text', s: ' ', marks: [] })
      else events.push({ kind: 'br' })
    }
  }
  if (events.length > 0 && events[0].kind === 'text') {
    (events[0] as TextLeaf).s = (events[0] as TextLeaf).s.replace(/^\s+/, '')
  }
  if (events.length > 0 && events[events.length - 1].kind === 'text') {
    (events[events.length - 1] as TextLeaf).s = (events[events.length - 1] as TextLeaf).s.replace(/\s+$/, '')
  }
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].kind === 'text' && events[i + 1].kind === 'br') {
      (events[i] as TextLeaf).s = (events[i] as TextLeaf).s.replace(/\s+$/, '')
    }
  }
  return events.filter(e => e.kind !== 'text' || (e as TextLeaf).s.length > 0)
}

function buildTree(leaves: Leaf[], depth: number): Node[] {
  const result: Node[] = []
  let i = 0
  while (i < leaves.length) {
    const leaf = leaves[i]
    if (leaf.kind !== 'text' || depth >= leaf.marks.length) {
      result.push(leaf)
      i++
    } else {
      const mark = leaf.marks[depth]
      const group: Leaf[] = [leaf]
      let j = i + 1
      while (j < leaves.length) {
        const lj = leaves[j]
        if (lj.kind !== 'text' || lj.marks[depth] !== mark) break
        group.push(lj)
        j++
      }
      result.push({ kind: 'group', mark, items: buildTree(group, depth + 1) })
      i = j
    }
  }
  return result
}

function touchingPrePass(items: Node[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind !== 'group') continue
    touchingPrePass(item.items)
    if (i > 0) {
      const prev = items[i - 1]
      if (prev.kind === 'group') {
        if ((item.mark === 'bold' || item.mark === 'italic') && (prev.mark === 'bold' || prev.mark === 'italic')) {
          item.forceSpan = true
          prev.forceSpan = true
        }
      }
    }
  }
}

const PUNCT = /[\p{P}\p{S}]/u
const isPunct = (c: string) => PUNCT.test(c)
const isWS = (c: string) => c === '' || /\s/.test(c)

function leftFlankingOk(before: string, after: string): boolean {
  if (!after || isWS(after)) return false
  if (!isPunct(after)) return true
  return before === '' || isWS(before) || isPunct(before)
}

function rightFlankingOk(cbefore: string, cafter: string): boolean {
  if (!cbefore || isWS(cbefore)) return false
  if (!isPunct(cbefore)) return true
  return cafter === '' || isWS(cafter) || isPunct(cafter)
}

function nextFirstChar(items: Node[], idx: number): string {
  const n = items[idx + 1]
  if (!n) return ''
  if (n.kind === 'text') return n.s[0] ?? ''
  if (n.kind === 'group') return '*'
  if (n.kind === 'blank') return '{'
  return ''
}

interface St { lineStart: boolean }

function render(items: Node[], st: St, wholeLine: Set<Leaf>): string {
  let out = ''
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'text') {
      let escaped = escapeInline(item.s)
      // Prevent a trailing unescaped `{` from merging with the `{{` of a
      // following blank leaf (e.g. text "a{" + blank → "a{{{x}}" which the
      // parser reads as a blank starting one brace too early).
      const next = items[i + 1]
      if (next && next.kind === 'blank' && escaped.endsWith('{')) {
        let bs = 0
        for (let k = escaped.length - 2; k >= 0 && escaped[k] === '\\'; k--) bs++
        if (bs % 2 === 0) {
          escaped = escaped.slice(0, -1) + '\\{'
        }
      }
      out += st.lineStart ? escapeLineStart(escaped, wholeLine.has(item)) : escaped
      st.lineStart = false
    } else if (item.kind === 'blank') {
      out += `{{${item.answers.map(escapeAnswer).join(' | ')}}}`
      st.lineStart = false
    } else if (item.kind === 'br') {
      out += '\\\n'
      st.lineStart = true
    } else {
      const prevChar = out.length ? out[out.length - 1] : ''
      st.lineStart = false
      const inner = render(item.items, st, wholeLine)
      const lead = (inner.match(/^\s*/) ?? [''])[0]
      const trail = (inner.match(/\s*$/) ?? [''])[0]
      const core = inner.trim()
      if (!core) { out += inner; continue }
      let open: string, close: string
      if (item.mark === 'underline') { open = '['; close = ']{.u}' }
      else if (item.mark === 'highlight') { open = '=='; close = '==' }
      else if (item.mark === 'bold') { open = '**'; close = '**' }
      else { open = '*'; close = '*' }
      if (item.mark === 'bold' || item.mark === 'italic') {
        const before = lead ? lead[0] : prevChar
        const after = core[0]
        const cbefore = core[core.length - 1]
        const cafter = trail ? trail[0] : nextFirstChar(items, i)
        if (item.forceSpan || !leftFlankingOk(before, after) || !rightFlankingOk(cbefore, cafter)) {
          open = '['
          close = item.mark === 'bold' ? ']{.b}' : ']{.i}'
        }
      }
      out += lead + open + core + close + trail
    }
  }
  return out
}

export function serializeInline(parent: PMNode, opts?: { cell?: boolean; lineStart?: boolean }): string {
  const cell = !!opts?.cell
  const lineStart = opts?.lineStart !== false
  const leaves = toEvents(parent, cell)
  const items = buildTree(leaves, 0)
  touchingPrePass(items)
  const wholeLine = new Set<Leaf>()
  let seg: Node[] = []
  for (const item of items) {
    if (item.kind === 'br') {
      if (seg.length === 1 && seg[0].kind === 'text') wholeLine.add(seg[0] as Leaf)
      seg = []
    } else seg.push(item)
  }
  if (seg.length === 1 && seg[0].kind === 'text') wholeLine.add(seg[0] as Leaf)
  let out = render(items, { lineStart }, wholeLine)
  if (cell) out = escapeCellPipes(out)
  return out
}
