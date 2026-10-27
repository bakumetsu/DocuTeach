import { describe, it, expect } from 'vitest'
import { createMd } from '../src/markdown/md'
import { schema } from '../src/editor/extensions'
import { inlineToNodes } from '../src/markdown/inline'
import type { Node as PMNode } from '@tiptap/pm/model'

// --- helpers -----------------------------------------------------------

function parseInline(src: string): PMNode[] {
  const md = createMd()
  const tokens = md.parseInline(src, {})
  const children = tokens[0]?.children ?? null
  return inlineToNodes(children, schema)
}

/** Produce a compact, assertion-friendly string for a flat list of inline nodes. */
function serialize(nodes: PMNode[]): string {
  return nodes
    .map((n) => {
      if (n.isText) {
        const marks = n.marks.map((m) => m.type.name).sort().join(',')
        return marks ? `[${n.text}|${marks}]` : n.text
      }
      if (n.type.name === 'hardBreak') return '<br/>'
      if (n.type.name === 'blank') {
        const answers = (n.attrs as { answers?: string[] }).answers ?? []
        return `<blank:${answers.join(',')}>`
      }
      return n.type.name
    })
    .join(' ')
}

// --- tests -------------------------------------------------------------

describe('inlineToNodes', () => {
  it('plain text', () => {
    const nodes = parseInline('hello')
    expect(serialize(nodes)).toBe('hello')
  })

  it('bold **b**', () => {
    const nodes = parseInline('**b**')
    expect(serialize(nodes)).toBe('[b|bold]')
  })

  it('italic *i*', () => {
    const nodes = parseInline('*i*')
    expect(serialize(nodes)).toBe('[i|italic]')
  })

  it('nested **a *b***', () => {
    const nodes = parseInline('**a *b***')
    expect(serialize(nodes)).toBe('[a |bold] [b|bold,italic]')
  })

  it('span underline [u]{.u}', () => {
    const nodes = parseInline('[u]{.u}')
    expect(serialize(nodes)).toBe('[u|underline]')
  })

  it('highlight ==h==', () => {
    const nodes = parseInline('==h==')
    expect(serialize(nodes)).toBe('[h|highlight]')
  })

  it('span+mark [==both==]{.u} carries underline and highlight', () => {
    const nodes = parseInline('[==both==]{.u}')
    expect(serialize(nodes)).toBe('[both|highlight,underline]')
  })

  it('blank {{x}}', () => {
    const nodes = parseInline('{{x}}')
    expect(serialize(nodes)).toBe('<blank:x>')
  })

  it('text around blank: a {{x}} b', () => {
    const nodes = parseInline('a {{x}} b')
    expect(serialize(nodes)).toBe('a  <blank:x>  b')
  })

  it('hard break a\\nb', () => {
    const nodes = parseInline('a\\\nb')
    expect(serialize(nodes)).toBe('a <br/> b')
  })

  it('soft break a\nb yields joined text "a b"', () => {
    const nodes = parseInline('a\nb')
    // Should be text("a"), text(" "), text("b") — joined gives "a b"
    const joined = nodes
      .filter((n) => n.isText)
      .map((n) => (n as PMNode & { text: string }).text)
      .join('')
    expect(joined).toBe('a b')
  })

  it('escaped \\*x\\* is literal *x*', () => {
    const nodes = parseInline('\\*x\\*')
    expect(serialize(nodes)).toBe('*x*')
  })

  it('backtick `x` stays literal (backticks rule disabled)', () => {
    const nodes = parseInline('`x`')
    expect(serialize(nodes)).toBe('`x`')
  })

  it('null children returns empty array', () => {
    expect(inlineToNodes(null, schema)).toEqual([])
  })

  it('empty children array returns empty array', () => {
    expect(inlineToNodes([], schema)).toEqual([])
  })
})
