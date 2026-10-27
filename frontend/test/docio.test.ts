import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Editor } from '@tiptap/core'
import { extensions } from '../src/editor/extensions'
import { docToMarkdown, docJsonFromMarkdown, replaceDocument, setMeta } from '../src/editor/docio'
import { parseMarkdown } from '../src/markdown/parse'
import type { Meta } from '../src/markdown/frontmatter'

function makeEditor(content?: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions,
    content: content ? parseMarkdown(content).doc.toJSON() : undefined,
  })
}

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'basic-text.md'), 'utf-8')

describe('docToMarkdown', () => {
  it('serializes a loaded doc back to the original markdown', () => {
    const editor = makeEditor(FIXTURE)
    const md = docToMarkdown(editor)
    expect(md).toBe(FIXTURE)
    editor.destroy()
  })
})

describe('docJsonFromMarkdown', () => {
  it('returns json and warnings', () => {
    const { json, warnings } = docJsonFromMarkdown('# Title\n\nBody.')
    expect(json).toBeTypeOf('object')
    expect(Array.isArray(warnings)).toBe(true)
  })

  it('returns a warning for an unclosed note', () => {
    const md = ':::note\nThis note has no closing marker\n'
    const { warnings } = docJsonFromMarkdown(md)
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('replaceDocument', () => {
  it('swaps content and a single undo restores the previous markdown and meta', () => {
    const editor = makeEditor(FIXTURE)
    const beforeMd = docToMarkdown(editor)
    const beforeMeta = editor.state.doc.attrs.meta as Meta

    const newMd = '# Replaced\n\nNew content here.'
    replaceDocument(editor, newMd)

    expect(docToMarkdown(editor)).toBe('# Replaced\n\nNew content here.\n')

    editor.commands.undo()

    expect(docToMarkdown(editor)).toBe(beforeMd)
    expect(editor.state.doc.attrs.meta).toEqual(beforeMeta)

    editor.destroy()
  })

  it('returns warnings from the parsed markdown', () => {
    const editor = makeEditor('# Old\n')
    const warnings = replaceDocument(editor, ':::note\nunclosed\n')
    expect(warnings.length).toBeGreaterThan(0)
    editor.destroy()
  })
})

describe('setMeta', () => {
  it('changes doc attrs meta and one undo restores it', () => {
    const editor = makeEditor('# Doc\n\nText.')
    const originalMeta = editor.state.doc.attrs.meta as Meta

    const newMeta: Meta = { raw: '---\ntitle: New\n---\n', data: { title: 'New' }, broken: false }
    setMeta(editor, newMeta)

    expect(editor.state.doc.attrs.meta).toEqual(newMeta)

    editor.commands.undo()

    expect(editor.state.doc.attrs.meta).toEqual(originalMeta)

    editor.destroy()
  })
})
