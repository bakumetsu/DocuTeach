import { describe, it, expect } from 'vitest'
import { schema } from '../src/editor/extensions'
import { serializeInline } from '../src/markdown/serialize-inline'
import type { Node } from '@tiptap/pm/model'

function text(s: string, marks: string[] = []): Node {
  const m = marks.map(name => schema.marks[name].create())
  return schema.text(s, m)
}
function blank(answers: string[] = []): Node {
  return schema.nodes.blank.create({ answers })
}
function br(): Node {
  return schema.nodes.hardBreak.create()
}
function para(...children: Node[]): Node {
  return schema.nodes.paragraph.create(null, children)
}

describe('serializeInline', () => {
  it('plain text', () => {
    expect(serializeInline(para(text('Hello world')))).toBe('Hello world')
  })
  it('bold', () => {
    expect(serializeInline(para(text('b', ['bold'])))).toBe('**b**')
  })
  it('italic', () => {
    expect(serializeInline(para(text('i', ['italic'])))).toBe('*i*')
  })
  it('underline', () => {
    expect(serializeInline(para(text('u', ['underline'])))).toBe('[u]{.u}')
  })
  it('highlight', () => {
    expect(serializeInline(para(text('h', ['highlight'])))).toBe('==h==')
  })
  it('bold+italic same text', () => {
    expect(serializeInline(para(text('x', ['bold', 'italic'])))).toBe('***x***')
  })
  it('underline+highlight', () => {
    expect(serializeInline(para(text('both', ['underline', 'highlight'])))).toBe('[==both==]{.u}')
  })
  it('text a bold then plain', () => {
    expect(serializeInline(para(text('a ', ['bold']), text('b')))).toBe('**a** b')
  })
  it('bold Note: followed by plain Use', () => {
    expect(serializeInline(para(text('Note:', ['bold']), text('Use')))).toBe('[Note:]{.b}Use')
  })
  it('touching bold a then italic b', () => {
    expect(serializeInline(para(text('a', ['bold']), text('b', ['italic'])))).toBe('[a]{.b}[b]{.i}')
  })
  it('nested bold bold italic', () => {
    expect(serializeInline(para(text('bold ', ['bold']), text('italic', ['bold', 'italic'])))).toBe('**bold *italic***')
  })
  it('blank between bold text', () => {
    expect(serializeInline(para(text('a', ['bold']), text(' '), blank(['x']), text(' '), text('b', ['bold'])))).toBe('**a** {{x}} **b**')
  })
  it('blank with alternatives and escapes', () => {
    expect(serializeInline(para(blank(['has lived', "'s lived"])))).toBe("{{has lived | 's lived}}")
    expect(serializeInline(para(blank(['a|b'])))).toBe('{{a\\|b}}')
  })
  it('hard break between two texts', () => {
    expect(serializeInline(para(text('a'), br(), text('b')))).toBe('a\\\nb')
  })
  it('hard break then 2. x', () => {
    expect(serializeInline(para(text('a'), br(), text('2. x')))).toBe('a\\\n2\\. x')
  })
  it('text 1. x alone', () => {
    expect(serializeInline(para(text('1. x')))).toBe('1\\. x')
  })
  it('line only ______', () => {
    expect(serializeInline(para(text('______')))).toBe('\\______')
  })
  it('a == b', () => {
    expect(serializeInline(para(text('a == b')))).toBe('a \\=\\= b')
  })
  it('leading/trailing spaces trimmed', () => {
    expect(serializeInline(para(text('  hello  ')))).toBe('hello')
  })
  it('cell mode pipe', () => {
    expect(serializeInline(para(text('a | b')), { cell: true })).toBe('a \\| b')
  })
  it('text ending in { before blank is escaped', () => {
    expect(serializeInline(para(text('a{'), blank(['x'])))).toBe('a\\{{{x}}')
  })
})
