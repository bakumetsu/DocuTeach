import type { Token } from 'markdown-it'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { inlineToNodes } from './inline'

export interface BuildCtx {
  warnings: string[]
  splitSeen: boolean
}

export function buildBlocks(tokens: Token[], lines: string[], schema: Schema, ctx: BuildCtx): PMNode[] {
  const cur = { i: 0 }
  let lastParaEnd: number | null = null
  let lastParaIndex: number | null = null
  let lastParaInline: Token[] | null = null

  type Mode = 'doc' | 'note' | 'item'

  function safe(type: string, attrs: Record<string, unknown> | null, content: readonly PMNode[]): PMNode {
    try {
      const n = schema.node(type, attrs as never, content)
      if (n) return n
    } catch { /* fall through */ }
    const text = textOf(content)
    return schema.node('paragraph', null, text ? [schema.text(text)] : [])
  }

  function textOf(nodes: readonly PMNode[]): string {
    return nodes.map(n => n.textContent).join('')
  }

  function plainText(node: PMNode): string {
    return node.textContent
  }

  function parseSeq(stop: string | null, mode: Mode): PMNode[] {
    const result: PMNode[] = []
    while (cur.i < tokens.length && (stop === null || tokens[cur.i].type !== stop)) {
      const tok = tokens[cur.i]
      switch (tok.type) {
        case 'heading_open':
          result.push(parseHeading())
          break
        case 'paragraph_open':
          parseParagraph(mode, result)
          break
        case 'bullet_list_open':
        case 'ordered_list_open':
          result.push(parseList(mode, result))
          break
        case 'table_open':
          result.push(parseTable())
          break
        case 'teacher_open':
          result.push(parseTeacher(tok))
          break
        case 'align_open':
          result.push(...parseAlign(tok, mode))
          break
        case 'raw_block':
          result.push(schema.nodes.rawBlock.create({ text: tok.content ?? '' }))
          cur.i++
          break
        case 'split_point':
          result.push(parseSplit(tok))
          break
        default:
          cur.i++
          break
      }
    }
    return result
  }

  function parseHeading(): PMNode {
    const tok = tokens[cur.i]
    const level = parseInt(tok.tag.slice(1), 10)
    cur.i++ // past heading_open
    const inlineTok = tokens[cur.i]
    cur.i++ // past inline
    cur.i++ // past heading_close
    return safe('heading', { level, align: 'left' }, inlineToNodes(inlineTok.children, schema))
  }

  function parseParagraph(mode: Mode, result: PMNode[]): void {
    const tok = tokens[cur.i]
    cur.i++ // past paragraph_open
    const inlineTok = tokens[cur.i]
    cur.i++ // past inline
    cur.i++ // past paragraph_close
    result.push(safe('paragraph', { align: 'left' }, inlineToNodes(inlineTok.children, schema)))
    if (mode === 'doc') {
      lastParaEnd = tok.map ? tok.map[1] : null
      lastParaIndex = result.length - 1
      lastParaInline = inlineTok.children
    }
  }

  function parseList(mode: Mode, result: PMNode[]): PMNode {
    const listTok = tokens[cur.i]
    const isBullet = listTok.type === 'bullet_list_open'
    cur.i++ // past list_open

    // --- MCQ check (doc mode, bullet lists, >= 2 items) ---
    if (mode === 'doc' && isBullet) {
      const mcqResult = scanMcq()
      if (mcqResult) {
        const opts = mcqResult.opts
        const multi = opts.filter(o => o.correct).length > 1
        let qChildren: Token[] | null = null
        if (lastParaIndex !== null && lastParaEnd === (listTok.map ? listTok.map[0] : -1)) {
          qChildren = lastParaInline
          result.pop()
          lastParaIndex = null
          lastParaEnd = null
          lastParaInline = null
        }
        const question = safe('mcqQuestion', null, inlineToNodes(qChildren, schema))
        const optionNodes = opts.map(o => {
          const children = o.children.map(c => {
            if (c.type === 'text' && /^\[( |x|X)\]( |$)/.test(c.content)) {
              return { ...c, content: c.content.replace(/^\[( |x|X)\] ?/, '') } as Token
            }
            return c
          })
          return safe('mcqOption', { correct: o.correct }, inlineToNodes(children, schema))
        })
        cur.i = mcqResult.endI + 1 // past list_close
        return safe('mcq', { multi }, [question, ...optionNodes])
      }
    }

    // --- Normal list ---
    const itemNodes: PMNode[] = []
    while (cur.i < tokens.length && tokens[cur.i].type === 'list_item_open') {
      cur.i++ // past list_item_open
      const children = parseSeq('list_item_close', 'item')
      cur.i++ // past list_item_close

      let para: PMNode | null = null
      const nested: PMNode[] = []
      for (const child of children) {
        const t = child.type.name
        if (t === 'paragraph' && !para) {
          para = child
        } else if (t === 'bulletList' || t === 'orderedList') {
          nested.push(child)
        } else {
          const txt = plainText(child)
          if (!para) {
            para = schema.node('paragraph', null, [schema.text(txt)])
          } else {
            const existing = textOf(para.content.content)
            para = schema.node('paragraph', para.attrs, [schema.text(existing + ' ' + txt)])
          }
        }
      }
      if (!para) para = schema.node('paragraph', null, [])
      itemNodes.push(safe('listItem', null, [para, ...nested]))
    }
    cur.i++ // past list_close
    return safe(isBullet ? 'bulletList' : 'orderedList', null, itemNodes)
  }

  function scanMcq(): { opts: { correct: boolean; children: Token[] }[]; endI: number } | null {
    let scanI = cur.i
    const opts: { correct: boolean; children: Token[] }[] = []
    while (scanI < tokens.length && tokens[scanI].type === 'list_item_open') {
      scanI++ // past list_item_open
      const itemTokens: Token[] = []
      while (scanI < tokens.length && tokens[scanI].type !== 'list_item_close') {
        itemTokens.push(tokens[scanI])
        scanI++
      }
      scanI++ // past list_item_close

      const paraOpens = itemTokens.filter(t => t.type === 'paragraph_open')
      const hasNestedList = itemTokens.some(t => t.type === 'bullet_list_open' || t.type === 'ordered_list_open')
      if (paraOpens.length !== 1 || hasNestedList) return null
      if (!paraOpens[0].hidden) return null
      const inlineTok = itemTokens.find(t => t.type === 'inline')
      if (!inlineTok || !inlineTok.children || inlineTok.children.length === 0) return null
      const m = /^\[( |x|X)\]( |$)/.exec(inlineTok.content)
      if (!m) return null
      opts.push({ correct: m[1] !== ' ', children: inlineTok.children })
    }
    if (opts.length >= 2) return { opts, endI: scanI }
    return null
  }

  function parseTable(): PMNode {
    cur.i++ // past table_open
    const rows: PMNode[] = []
    while (cur.i < tokens.length && tokens[cur.i].type !== 'table_close') {
      if (tokens[cur.i].type === 'tr_open') {
        cur.i++ // past tr_open
        const cells: PMNode[] = []
        while (cur.i < tokens.length && tokens[cur.i].type !== 'tr_close') {
          const cellTok = tokens[cur.i]
          const isHeader = cellTok.type === 'th_open'
          cur.i++ // past th_open/td_open
          const inlineTok = tokens[cur.i]
          cur.i++ // past inline
          cur.i++ // past th_close/td_close
          const para = safe('paragraph', null, inlineToNodes(inlineTok.children, schema))
          cells.push(safe(isHeader ? 'tableHeader' : 'tableCell', null, [para]))
        }
        cur.i++ // past tr_close
        rows.push(safe('tableRow', null, cells))
      } else {
        cur.i++ // skip thead_open, thead_close, tbody_open, tbody_close
      }
    }
    cur.i++ // past table_close
    return safe('table', null, rows)
  }

  function parseTeacher(openTok: Token): PMNode {
    const tag = openTok.meta ? (openTok.meta as { tag?: string }).tag : undefined
    cur.i++ // past teacher_open
    const children = parseSeq('teacher_close', 'note')
    cur.i++ // past teacher_close
    const coerced = children.flatMap(coerceToAllowed)
    const content = coerced.length > 0 ? coerced : [schema.node('paragraph', null, [])]
    return safe('teacherNote', { tag }, content)
  }

  function coerceToAllowed(node: PMNode): PMNode[] {
    const t = node.type.name
    if (t === 'paragraph' || t === 'bulletList' || t === 'orderedList') return [node]
    if (t === 'heading') return [schema.node('paragraph', null, node.content)]
    if (t === 'table') {
      const rows = node.content.content
      return rows.map(row => {
        const cellTexts = row.content.content.map(c => textOf(c.content.content))
        return schema.node('paragraph', null, [schema.text(cellTexts.join(' | '))])
      })
    }
    const text = plainText(node)
    return [schema.node('paragraph', null, text ? [schema.text(text)] : [])]
  }

  function parseAlign(openTok: Token, mode: Mode): PMNode[] {
    const align = openTok.meta ? (openTok.meta as { align?: string }).align : undefined
    cur.i++ // past align_open
    const children = parseSeq('align_close', mode)
    cur.i++ // past align_close
    if (mode === 'doc' && align) {
      return children.map(child => {
        if (child.type.name === 'paragraph' || child.type.name === 'heading') {
          return schema.node(child.type.name, { ...child.attrs, align }, child.content)
        }
        return child
      })
    }
    return children
  }

  function parseSplit(tok: Token): PMNode {
    const label = tok.meta ? (tok.meta as { label?: string }).label : undefined
    cur.i++
    if (!ctx.splitSeen) {
      ctx.splitSeen = true
      return schema.nodes.splitPoint.create({ label: label || 'Homework starts here' })
    }
    const start = tok.map ? tok.map[0] : 0
    const end = tok.map ? tok.map[1] : start
    const text = lines.slice(start, end).join('\n')
    ctx.warnings.push('Only one split point is allowed; the extra one was kept as an unsupported block')
    return schema.nodes.rawBlock.create({ text })
  }

  return parseSeq(null, 'doc')
}
