import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { parseMarkdown } from '../src/markdown/parse';
import { buildSnapshot } from '../src/editor/suggest/snapshot';
import { startRequest, addItem, getSuggestState, setFocus, type Item } from '../src/editor/suggest/plugin';
import { serializeMarkdown } from '../src/markdown/serialize';
import { projectStudent } from '../src/editor/project';
import { docToMarkdown } from '../src/editor/docio';
import { extensions } from '../src/editor/extensions';
import { SuggestCardExtension, badgesFor, hasBlockingFlag } from '../src/editor/suggest/card';
import { wordDiff } from '../src/editor/suggest/diff';
import { ReviewBar, acceptAllDisabled } from '../src/editor/ReviewBar';
import { useApp } from '../src/state/store';
import { api } from '../src/api';
import { render, cleanup } from '@testing-library/react';
import { createElement } from 'react';

const MD = 'Alpha\n\nBeta\n\nGamma';

const editorExtensions = extensions.some((ext) => ext.name === 'suggestCards')
  ? extensions
  : [...extensions, SuggestCardExtension];

function createEditor(md = MD) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: editorExtensions, content: parseMarkdown(md).doc.toJSON() });
}

function blocks(e: Editor) {
  return buildSnapshot(e, 'r', 'L1').blocks;
}

function mk(e: Editor, kind: Item['kind'], i: number, markdown?: string, opId = 'op1', requestId = 'r1'): Item {
  const b = blocks(e)[i];
  if (kind === 'insert')
    return { opId, kind, from: b.to, to: b.to, anchorPos: b.from + 1, baseHash: b.hash, markdown, flags: [], status: 'pending', requestId };
  return { opId, kind, from: b.from, to: b.to, baseHash: b.hash, markdown, flags: [], status: 'pending', requestId };
}

function flush(e: Editor) {
  e.commands.focus();
}

let editor: Editor;
beforeEach(() => {
  editor = createEditor();
  useApp.setState({ lessonId: 'L1' });
  vi.spyOn(api.docs.checkpoints, 'create').mockResolvedValue({ id: 'cp1', name: '', createdAt: '', markdown: '' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  editor.destroy();
  document.body.innerHTML = '';
});

describe('suggest-ui', () => {
  const diffCases: { name: string; oldText: string; newText: string; oldSegs?: number; nextSegs?: number; oldChanged?: boolean; nextChanged?: boolean }[] = [
    { name: 'equal', oldText: 'same text', newText: 'same text', oldSegs: 1, nextSegs: 1, oldChanged: false, nextChanged: false },
    { name: 'both empty', oldText: '', newText: '', oldSegs: 0, nextSegs: 0, oldChanged: false, nextChanged: false },
    { name: 'one word replaced', oldText: 'hello world', newText: 'hello there', oldChanged: true, nextChanged: true },
    { name: 'unicode vietnamese', oldText: 'Tôi đi học', newText: 'Tôi đến trường', oldChanged: true, nextChanged: true },
  ];

  it.each(diffCases)(
    'wordDiff $name',
    ({ oldText, newText, oldSegs, nextSegs, oldChanged, nextChanged }) => {
      const d = wordDiff(oldText, newText);
      expect(d.old.map((s) => s.text).join('')).toBe(oldText);
      expect(d.next.map((s) => s.text).join('')).toBe(newText);
      if (oldSegs !== undefined) expect(d.old.length).toBe(oldSegs);
      if (nextSegs !== undefined) expect(d.next.length).toBe(nextSegs);
      if (oldChanged !== undefined) expect(d.old.some((s) => s.changed)).toBe(oldChanged);
      if (nextChanged !== undefined) expect(d.next.some((s) => s.changed)).toBe(nextChanged);
    },
  );

  it('badgesFor and hasBlockingFlag', () => {
    const aiItem: Item = { opId: 'op1', kind: 'replace', from: 0, to: 0, baseHash: 'h', markdown: 'x', flags: ['ai_answer'], status: 'pending', requestId: 'r1' };
    expect(badgesFor(aiItem)).toContainEqual({ key: 'ai_answer', label: 'AI answer: check it', tone: 'amber' });

    const rewriteItem: Item = { opId: 'op1', kind: 'replace', from: 0, to: 0, baseHash: 'h', markdown: 'x', flags: ['large_rewrite'], status: 'pending', requestId: 'r1' };
    expect(badgesFor(rewriteItem)).toContainEqual({ key: 'large_rewrite', label: 'Large rewrite', tone: 'grey' });

    const plainItem: Item = { opId: 'op1', kind: 'replace', from: 0, to: 0, baseHash: 'h', markdown: 'x', flags: [], status: 'pending', requestId: 'r1' };
    expect(badgesFor(plainItem)).toEqual([]);

    expect(hasBlockingFlag(aiItem)).toBe(true);

    const removesItem: Item = { opId: 'op1', kind: 'replace', from: 0, to: 0, baseHash: 'h', markdown: 'x', flags: ['removes_text'], status: 'pending', requestId: 'r1' };
    expect(hasBlockingFlag(removesItem)).toBe(false);
  });

  it('replace card renders labels and diff marks', () => {
    editor.destroy();
    editor = createEditor('Alpha\n\nBeta old\n\nGamma');
    startRequest(editor, 'r1', 'formal');
    const item = mk(editor, 'replace', 1, 'Beta new', 'op1');
    addItem(editor, item);
    flush(editor);

    const card = document.querySelector<HTMLElement>('.suggest-card[data-op-id="op1"]');
    expect(card).toBeTruthy();
    if (!card) return;

    const labels = Array.from(card.querySelectorAll('.suggest-col-label')).map((el) => el.textContent);
    expect(labels).toContain('Now');
    expect(labels).toContain('Suggested');
    expect(card.querySelector('.suggest-now del')).toBeTruthy();
    expect(card.querySelector('.suggest-new ins')).toBeTruthy();
  });

  it('insert card renders suggested column', () => {
    editor.destroy();
    editor = createEditor('Alpha\n\nBeta\n\nGamma');
    startRequest(editor, 'r1', 'formal');
    const item = mk(editor, 'insert', 1, 'New', 'op1');
    addItem(editor, item);
    flush(editor);

    const card = document.querySelector<HTMLElement>('.suggest-card[data-op-id="op1"]');
    expect(card).toBeTruthy();
    if (!card) return;

    const labels = Array.from(card.querySelectorAll('.suggest-col-label')).map((el) => el.textContent);
    expect(labels).toContain('Suggested');
    expect(card.querySelector('.suggest-new')).toBeTruthy();
  });

  it('delete card renders removed marker', () => {
    editor.destroy();
    editor = createEditor('Alpha\n\nBeta\n\nGamma');
    startRequest(editor, 'r1', 'formal');
    const item = mk(editor, 'delete', 1, undefined, 'op1');
    addItem(editor, item);
    flush(editor);

    const card = document.querySelector<HTMLElement>('.suggest-card[data-op-id="op1"]');
    expect(card).toBeTruthy();
    if (!card) return;

    expect(card.querySelector('.suggest-removed')).toBeTruthy();
    expect(card.querySelector('.suggest-now del')).toBeTruthy();
  });

  it('move card renders source and target', () => {
    editor.destroy();
    editor = createEditor('A1\n\nB2\n\nC3');
    startRequest(editor, 'r1', 'formal');
    const b0 = blocks(editor)[0];
    const b2 = blocks(editor)[2];
    const item: Item = {
      opId: 'op1',
      kind: 'move',
      from: b0.from,
      to: b0.to,
      anchorPos: b2.from,
      baseHash: b0.hash,
      markdown: 'A1',
      flags: [],
      status: 'pending',
      requestId: 'r1',
    };
    addItem(editor, item);
    flush(editor);

    const card = document.querySelector<HTMLElement>('.suggest-card[data-op-id="op1"]');
    expect(card).toBeTruthy();
    if (!card) return;

    const labels = Array.from(card.querySelectorAll('.suggest-col-label')).map((el) => el.textContent);
    expect(labels).toContain('Now');
    expect(labels).toContain('Suggested');
    expect(card.querySelector('.suggest-now del')).toBeTruthy();
  });

  it('stale card shows stale note and disables accept', () => {
    editor.destroy();
    editor = createEditor('Alpha\n\nBeta old\n\nGamma');
    startRequest(editor, 'r1', 'formal');
    const item = mk(editor, 'replace', 1, 'Beta new', 'op1');
    item.status = 'stale';
    addItem(editor, item);
    flush(editor);

    const card = document.querySelector<HTMLElement>('.suggest-card[data-op-id="op1"]');
    expect(card).toBeTruthy();
    if (!card) return;

    expect(card.querySelector('.suggest-stale')).toBeTruthy();
    const acceptBtn = card.querySelector<HTMLButtonElement>('.suggest-accept');
    expect(acceptBtn?.disabled).toBe(true);
  });

  it('acceptAllDisabled states', () => {
    const plain: Item = { opId: 'op1', kind: 'replace', from: 0, to: 0, baseHash: 'h', markdown: 'x', flags: [], status: 'pending', requestId: 'r1' };
    const ai: Item = { opId: 'op2', kind: 'replace', from: 0, to: 0, baseHash: 'h', markdown: 'x', flags: ['ai_answer'], status: 'pending', requestId: 'r1' };

    expect(acceptAllDisabled([], false)).toBe(true);
    expect(acceptAllDisabled([plain], false)).toBe(false);
    expect(acceptAllDisabled([plain, ai], false)).toBe(true);
    expect(acceptAllDisabled([plain], true)).toBe(true);
  });

  it('ReviewBar shows pending count and enables accept-all', () => {
    startRequest(editor, 'r1', 'formal');
    addItem(editor, mk(editor, 'replace', 0, 'A2', 'op1'));
    addItem(editor, mk(editor, 'replace', 1, 'B2', 'op2'));

    const { container } = render(createElement(ReviewBar, { editor }));
    expect(container.textContent).toContain('2 suggestions');
    const acceptAllBtn = container.querySelector<HTMLButtonElement>('.review-accept-all');
    expect(acceptAllBtn?.disabled).toBe(false);
  });

  it('ReviewBar disables accept-all for ai_answer item', () => {
    startRequest(editor, 'r1', 'formal');
    const item = mk(editor, 'replace', 0, 'A2', 'op1');
    item.flags = ['ai_answer'];
    addItem(editor, item);

    const { container } = render(createElement(ReviewBar, { editor }));
    const acceptAllBtn = container.querySelector<HTMLButtonElement>('.review-accept-all');
    expect(acceptAllBtn?.disabled).toBe(true);
  });

  it('ReviewBar renders nothing with zero items and not running', () => {
    const { container } = render(createElement(ReviewBar, { editor }));
    expect(container.innerHTML).toBe('');
  });

  it('Ctrl+Enter on a card accepts that item', () => {
    startRequest(editor, 'r1', 'formal');
    addItem(editor, mk(editor, 'replace', 1, 'Beta accepted', 'op1'));
    flush(editor);

    const card = document.querySelector<HTMLElement>('.suggest-card[data-op-id="op1"]');
    expect(card).toBeTruthy();
    if (!card) return;

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));

    expect(editor.getText({ blockSeparator: ' ' })).toContain('Beta accepted');
    expect(getSuggestState(editor).items.find((i) => i.opId === 'op1')).toBeUndefined();
  });

  it('Alt+ArrowDown on editor dom moves focus to next index', () => {
    editor.destroy();
    editor = createEditor('A1\n\nB2\n\nC3');
    startRequest(editor, 'r1', 'formal');
    addItem(editor, mk(editor, 'replace', 0, 'A9', 'op1'));
    addItem(editor, mk(editor, 'replace', 1, 'B9', 'op2'));
    flush(editor);
    setFocus(editor, 0);
    expect(getSuggestState(editor).focus).toBe(0);

    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));

    expect(getSuggestState(editor).focus).toBe(1);
  });

  it('student projection unchanged with pending items', () => {
    const beforeStudent = serializeMarkdown(projectStudent(editor.state.doc));
    const beforeDoc = docToMarkdown(editor);

    startRequest(editor, 'r1', 'formal');
    addItem(editor, mk(editor, 'replace', 0, 'Alpha 2', 'op1'));
    addItem(editor, mk(editor, 'delete', 2, undefined, 'op2'));
    addItem(editor, mk(editor, 'insert', 1, 'New', 'op3'));

    expect(getSuggestState(editor).items.length).toBe(3);
    expect(docToMarkdown(editor)).toBe(beforeDoc);
    expect(serializeMarkdown(projectStudent(editor.state.doc))).toBe(beforeStudent);
  });
});
