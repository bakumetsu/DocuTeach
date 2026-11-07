import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { api } from '../src/api';
import { useApp } from '../src/state/store';
import { extensions } from '../src/editor/extensions';
import { insertFragment } from '../src/editor/insert';
import { normalizeModelMarkdown } from '../src/editor/modelMarkdown';
import { parseMarkdown } from '../src/markdown/parse';
import { docToMarkdown } from '../src/editor/docio';

function createEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: extensions,
    content: parseMarkdown('First paragraph').doc.toJSON(),
  });
}

function typesOf(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(n.type.name));
  return out;
}

describe('normalizeModelMarkdown', () => {
  it('rewrites lettered options and a blockquote answer line', () => {
    const out = normalizeModelMarkdown('Pick one.\n\n- A) cat\n- B) dog\n- C) cow\n\n> **Answer: B**');
    expect(out).toContain('- [ ] cat');
    expect(out).toContain('- [x] dog');
    expect(out).toContain('- [ ] cow');
    expect(out).not.toMatch(/answer/i);
  });

  it('marks several correct letters', () => {
    const out = normalizeModelMarkdown('A. one\nB. two\nC. three\nAnswer: A and C');
    expect(out.split('\n')).toEqual(['- [x] one', '- [ ] two', '- [x] three']);
  });

  it('leaves plain text unchanged', () => {
    const md = '# Title\n\nSome **bold** text.\n\n1. one\n2. two';
    expect(normalizeModelMarkdown(md)).toBe(md);
  });

  it('leaves options untouched when the answer letter does not match', () => {
    const md = 'A) x\nB) y\nAnswer: F';
    expect(normalizeModelMarkdown(md)).toBe(md);
  });

  it('drops the answer line after options already in [x] form', () => {
    const out = normalizeModelMarkdown('- [ ] Three\n- [x] Four\n- [ ] Five\n> **Answer: B**');
    expect(out.split('\n')).toEqual(['- [ ] Three', '- [x] Four', '- [ ] Five']);
  });

  it('tolerates one blank line between options', () => {
    const out = normalizeModelMarkdown('A) x\n\nB) y\nAnswer: B');
    expect(out).toContain('- [ ] x');
    expect(out).toContain('- [x] y');
    expect(out).not.toMatch(/answer/i);
  });

  it('turns the explanation after an MCQ into a teacher note', () => {
    const out = normalizeModelMarkdown(
      'Pick one.\n\nA) x\nB) y\nAnswer: B\n\n*B is right because y.*\n\nNext?\n\nA) p\nB) q',
    );
    expect(out).toContain('- [x] y');
    expect(out).toContain('::: teacher\n*B is right because y.*\n:::');
    expect(out).toContain('Next?');
    expect(out.indexOf(':::')).toBeLessThan(out.indexOf('Next?'));
  });

  it('keeps a plain paragraph not after an MCQ as a paragraph', () => {
    const md = 'Just text.\n\nMore text.';
    expect(normalizeModelMarkdown(md)).toBe(md);
  });

  it('does not touch fenced code', () => {
    const md = '```\nA) x\nB) y\nAnswer: B\n```';
    expect(normalizeModelMarkdown(md)).toBe(md);
  });

  it('passes a well-formed pipe table through byte-identical', () => {
    const md = '| H1 | H2 |\n| --- | --- |\n| a | b |\n| c | d |';
    expect(normalizeModelMarkdown(md)).toBe(md);
  });

  it('replaces <br> variants with a single space in pipe-table lines', () => {
    expect(normalizeModelMarkdown('| a<br>b | c |')).toBe('| a b | c |');
    expect(normalizeModelMarkdown('| a<BR/>b | c |')).toBe('| a b | c |');
    expect(normalizeModelMarkdown('| a<br />b | c |')).toBe('| a b | c |');
  });

  it('applies br replacement to | lines without separator, leaves non-table lines alone', () => {
    const md = '| a<br>b | c |\n| d | e |';
    expect(normalizeModelMarkdown(md)).toBe('| a b | c |\n| d | e |');
    expect(normalizeModelMarkdown('hello<br>world')).toBe('hello<br>world');
  });

  it('does not replace <br> inside fenced code table lines', () => {
    const md = '```\n| a<br>b | c |\n```';
    expect(normalizeModelMarkdown(md)).toBe(md);
  });
});

describe('insertFragment with model markdown', () => {
  beforeEach(() => {
    useApp.setState({ lessonId: 'L1' });
    vi.spyOn(api.docs.checkpoints, 'create').mockResolvedValue({
      id: 'cp1', name: '', createdAt: '', markdown: '',
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('inserts a heading as a heading, not raw text', () => {
    const editor = createEditor();
    const r = insertFragment(editor, '## Unit 3\n\nBody text.', null);
    expect(r).toEqual({ ok: true, fallback: false });
    expect(typesOf(editor)).toContain('heading');
    expect(docToMarkdown(editor)).toContain('## Unit 3');
    editor.destroy();
  });

  it('keeps bold and a numbered list', () => {
    const editor = createEditor();
    const r = insertFragment(editor, 'Use **has** here.\n\n1. one\n2. two', null);
    expect(r.fallback).toBe(false);
    expect(typesOf(editor)).toContain('orderedList');
    expect(docToMarkdown(editor)).toContain('**has**');
    editor.destroy();
  });

  it('turns a loose MCQ plus answer line into an mcq with the right option', () => {
    const editor = createEditor();
    const r = insertFragment(
      editor,
      'Which is correct?\n\n- A) She go\n- B) She goes\n- C) She going\n\n> **Answer: B**',
      null,
    );
    expect(r.fallback).toBe(false);
    expect(typesOf(editor)).toContain('mcq');
    const md = docToMarkdown(editor);
    expect(md).toContain('[x] She goes');
    expect(md).toContain('[ ] She go');
    expect(md).not.toMatch(/Answer: B/);
    // The answer key reads [x] from the document, so it lists "She goes".
    expect(parseMarkdown(md).doc.textContent).toContain('She goes');
    editor.destroy();
  });

  it('puts the explanation in a teacher note, not the student text', () => {
    const editor = createEditor();
    insertFragment(
      editor,
      'Which is correct?\n\nA) She go\nB) She goes\nAnswer: B\n\nB is right: third person -s.',
      null,
    );
    expect(typesOf(editor)).toContain('mcq');
    expect(typesOf(editor)).toContain('teacherNote');
    const md = docToMarkdown(editor);
    expect(md).toContain('::: teacher');
    expect(md).toContain('third person -s');
    editor.destroy();
  });

  it('plain text still inserts as paragraphs', () => {
    const editor = createEditor();
    const r = insertFragment(editor, 'Hello there', null);
    expect(r.ok).toBe(true);
    expect(docToMarkdown(editor)).toContain('Hello there');
    editor.destroy();
  });

  it('a streamed MCQ insert is one undo step', () => {
    const editor = createEditor();
    const before = docToMarkdown(editor);
    insertFragment(editor, 'Q?\n\nA) x\nB) y\nAnswer: A', null);
    expect(docToMarkdown(editor)).not.toBe(before);
    editor.commands.undo();
    expect(docToMarkdown(editor)).toBe(before);
    editor.destroy();
  });
});
