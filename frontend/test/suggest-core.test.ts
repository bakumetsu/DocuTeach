import { serializeMarkdown } from '../src/markdown/serialize';
import { projectStudent } from '../src/editor/project';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { parseMarkdown } from '../src/markdown/parse';
import { hashText, buildSnapshot, nodeMarkdown } from '../src/editor/suggest/snapshot';
import { startRequest, addItem, getSuggestState, undoReject } from '../src/editor/suggest/plugin';
import type { Item } from '../src/editor/suggest/plugin';
import { liveCheck, acceptItem, acceptAll, rejectItem } from '../src/editor/suggest/apply';
import { useApp } from '../src/state/store';
import { extensions } from '../src/editor/extensions';
import { docToMarkdown } from '../src/editor/docio';
import { api } from '../src/api';

const MD = 'Alpha\n\nBeta\n\nGamma';

function createEditor(md = MD) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions, content: parseMarkdown(md).doc.toJSON() });
}
function blocks(e: Editor) { return buildSnapshot(e, 'r', 'L1').blocks; }
function mk(e: Editor, kind: Item['kind'], i: number, markdown?: string, opId = 'op1', requestId = 'r1'): Item {
  const b = blocks(e)[i];
  if (kind === 'insert')
    return { opId, kind, from: b.to, to: b.to, anchorPos: b.from + 1, baseHash: b.hash, markdown, flags: [], status: 'pending', requestId };
  return { opId, kind, from: b.from, to: b.to, baseHash: b.hash, markdown, flags: [], status: 'pending', requestId };
}
const docJSON = (e: Editor) => JSON.stringify(e.getJSON());

let editor: Editor;
beforeEach(() => {
  editor = createEditor();
  useApp.setState({ lessonId: 'L1' });
  vi.spyOn(api.docs.checkpoints, 'create').mockResolvedValue({ id: 'cp1', name: '', createdAt: '', markdown: '' });
});
afterEach(() => { vi.restoreAllMocks(); editor.destroy(); });

const NL = String.fromCharCode(10, 10);

describe('suggest-core', () => {

it('hashText stable, distinct, unicode-safe', () => {
  expect(hashText('hello')).toBe(hashText('hello'));
  expect(hashText('hello')).not.toBe(hashText('world'));
  expect(hashText('xin chào')).toMatch(/^[0-9a-f]{8}$/);
  expect(hashText('🎉🎊')).toMatch(/^[0-9a-f]{8}$/);
});

it('buildSnapshot: one block per top-level node, ids & hashes correct', () => {
  const bl = blocks(editor);
  expect(bl.length).toBe(3);
  bl.forEach((b, i) => {
    expect(b.id).toBe(`b${i}`);
    const node = editor.state.doc.child(i)!;
    expect(b.hash).toBe(hashText(nodeMarkdown(editor, node)));
  });
});

it('item position shifts after insert; liveCheck still ok', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 1, 'Beta v2', 'op1'));
  const before = getSuggestState(editor).items[0];
  const b = blocks(editor)[0];
  editor.commands.insertContentAt(b.from + 1, 'Hello');
  const after = getSuggestState(editor).items[0];
  expect(after.from).toBe(before.from + 5);
  expect(after.to).toBe(before.to + 5);
  expect(liveCheck(editor, after)).toEqual({ ok: true });
});

it('deleting target block → stale; docChanged tr does not throw', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 1, 'x', 'op1'));
  const b1 = blocks(editor)[1];
  expect(() => {
    const tr = editor.state.tr;
    tr.delete(b1.from, b1.to);
    editor.view.dispatch(tr);
  }).not.toThrow();
  const item = getSuggestState(editor).items[0];
  const chk = liveCheck(editor, item);
  expect(chk.ok === false || item.status === 'stale').toBe(true);
});

it('editing target text → stale; acceptItem false; doc unchanged', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 1, 'Beta new', 'op1'));
  const b1 = blocks(editor)[1];
  editor.commands.insertContentAt(b1.from + 1, '!');
  const edited = docJSON(editor);
  const item = getSuggestState(editor).items[0];
  const chk = liveCheck(editor, item);
  expect(chk.ok).toBe(false);
  if (!chk.ok) expect(chk.reason).toBe('stale');
  expect(acceptItem(editor, 'op1').ok).toBe(false);
  expect(docJSON(editor)).toBe(edited); // doc unchanged by failed accept
});

it('accept one replace; one undo restores exactly; redo reapplies', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 1, 'Beta formal', 'op1'));
  const before = docJSON(editor);
  expect(acceptItem(editor, 'op1').ok).toBe(true);
  expect(editor.getText({ blockSeparator: ' ' })).toContain('Beta formal');
  editor.commands.undo();
  expect(docJSON(editor)).toBe(before);
  editor.commands.redo();
  expect(editor.getText({ blockSeparator: ' ' })).toContain('Beta formal');
});

it('acceptAll 3 replaces = one undo step', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 0, 'A2', 'op1'));
  addItem(editor, mk(editor, 'replace', 1, 'B2', 'op2'));
  addItem(editor, mk(editor, 'replace', 2, 'C2', 'op3'));
  const before = docJSON(editor);
  const res = acceptAll(editor);
  expect(res).toEqual({ applied: 3, left: 0 });
  editor.commands.undo();
  expect(docJSON(editor)).toBe(before);
});

it('acceptAll: 1 good, 1 stale, 1 invalid → applied 1 left 2', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 0, 'A2', 'op1'));
  addItem(editor, mk(editor, 'replace', 1, 'B2', 'op2'));
  addItem(editor, mk(editor, 'replace', 2, '', 'op3')); // invalid: empty
  const b1 = blocks(editor)[1];
  editor.commands.insertContentAt(b1.from + 1, '!'); // make op2 stale
  const res = acceptAll(editor);
  expect(res.applied).toBe(1);
  expect(res.left).toBe(2);
  expect(editor.getText({ blockSeparator: ' ' })).toContain('A2');
});

it('rejectItem → rejected; undoReject restores; no undo history', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 1, 'B2', 'op1'));
  const before = docJSON(editor);
  rejectItem(editor, 'op1');
  const st = getSuggestState(editor);
  expect(st.items.find((i) => i.opId === 'op1')).toBeUndefined();
  expect(st.rejected.find((i) => i.opId === 'op1')).toBeDefined();
  expect(docJSON(editor)).toBe(before);
  expect(editor.can().undo()).toBe(false);
  undoReject(editor, ['op1']);
  expect(getSuggestState(editor).items.find((i) => i.opId === 'op1')).toBeDefined();
});

it('checkpoint: first accept creates once; second does not', () => {
  startRequest(editor, 'rcp', 'formal');
  addItem(editor, mk(editor, 'replace', 0, 'A2', 'op1', 'rcp'));
  addItem(editor, mk(editor, 'replace', 1, 'B2', 'op2', 'rcp'));
  acceptItem(editor, 'op1');
  expect(api.docs.checkpoints.create).toHaveBeenCalledTimes(1);
  const args = (api.docs.checkpoints.create as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
  expect(String(args[1]).startsWith('Before AI edit: ')).toBe(true);
  acceptItem(editor, 'op2');
  expect(api.docs.checkpoints.create).toHaveBeenCalledTimes(1);
});

it('pending items never enter the document or the student output', () => {
  editor = createEditor('Alpha'+NL+'> Note'+NL+'She {{went}} home'+NL+'Gamma');
  const beforeDoc = docToMarkdown(editor);
  const beforeStudent = serializeMarkdown(projectStudent(editor.state.doc));
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 0, 'Alpha 2', 'op1'));
  addItem(editor, mk(editor, 'delete', 3, undefined, 'op2'));
  addItem(editor, mk(editor, 'insert', 1, 'New', 'op3'));
  expect(getSuggestState(editor).items.length).toBe(3);
  expect(docToMarkdown(editor)).toBe(beforeDoc);
  expect(serializeMarkdown(projectStudent(editor.state.doc))).toBe(beforeStudent);
});

it('delete block 1 + insert anchored there → applied 2', () => {
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'delete', 1, undefined, 'op1'));
  addItem(editor, mk(editor, 'insert', 1, 'New', 'op2'));
  const res = acceptAll(editor);
  expect(res.applied).toBe(2);
});

it('acceptAll creates a checkpoint', () => {
  startRequest(editor, 'rcp2', 'formal');
  addItem(editor, mk(editor, 'replace', 1, 'Beta v2', 'op1', 'rcp2'));
  acceptAll(editor);
  expect(api.docs.checkpoints.create).toHaveBeenCalledTimes(1);
  const args = (api.docs.checkpoints.create as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(args[0]).toBe('L1');
  expect(typeof args[1]).toBe('string');
  expect(args[1]).not.toBe('');
});

it('split: replace inserting a split marker fails liveCheck', () => {
  const md = 'One\n\n<!-- split: A -->\n\nTwo\n\nThree';
  editor = createEditor(md);
  const before = docToMarkdown(editor);
  startRequest(editor, 'r1', 'formal');
  const item = mk(editor, 'replace', 3, '<!-- split: B -->\n\nThree', 'op1');
  addItem(editor, item);
  const r = liveCheck(editor, item);
  expect(r.ok).toBe(false);
  expect(docToMarkdown(editor)).toBe(before);
});

it('two replaces with split markers: acceptAll applies 1, leaves 1', () => {
  editor = createEditor('One\n\nTwo\n\nThree');
  startRequest(editor, 'r1', 'formal');
  addItem(editor, mk(editor, 'replace', 1, '<!-- split: S -->\n\nTwo', 'opA'));
  addItem(editor, mk(editor, 'replace', 2, '<!-- split: T -->\n\nThree', 'opB'));
  const result = acceptAll(editor);
  expect(result.applied + result.left).toBe(2);
  expect(result.left).toBeGreaterThanOrEqual(1);
});

it('move: block 0 moved after block 2', () => {
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
  acceptAll(editor);
  // Expected order after moving block 0 (A1) to after block 2 (C3): B2, C3, A1
  expect(docToMarkdown(editor).trim()).toBe(['B2', 'C3', 'A1'].join(NL));
});

it('invalid markdown: code block (warning) and empty string', () => {
  startRequest(editor, 'r1', 'formal');
  const bad = mk(editor, 'replace', 1, ['```', 'code', '```'].join(String.fromCharCode(10)), 'op1');
  addItem(editor, bad);
  expect(liveCheck(editor, bad)).toMatchObject({ ok: false, reason: 'invalid' });

  const empty = mk(editor, 'replace', 2, '', 'op2');
  addItem(editor, empty);
  expect(liveCheck(editor, empty)).toMatchObject({ ok: false, reason: 'invalid' });
});

const SPLIT = '<!-- split: Homework -->';
const MCQ_OK = ['Pick one', '- [x] yes', '- [ ] no'].join(String.fromCharCode(10));

function checkInsert(e: Editor, after: number, markdown: string) {
  startRequest(e, 'rv', 'x');
  const it = mk(e, 'insert', after, markdown, 'opv', 'rv');
  addItem(e, it);
  return liveCheck(e, it);
}

it('split: one in the middle is accepted', () => {
  expect(checkInsert(editor, 1, SPLIT).ok).toBe(true);
  expect(acceptItem(editor, 'opv').ok).toBe(true);
  expect(docToMarkdown(editor)).toContain(SPLIT);
});

it('split: second split in lesson refused (reason split)', () => {
  editor.destroy();
  editor = createEditor(['A', '<!-- split: One -->', 'B', 'C'].join(NL));
  expect(checkInsert(editor, 2, SPLIT)).toMatchObject({ ok: false, reason: 'split' });
});

it('split: as last block refused', () => {
  expect(checkInsert(editor, 2, SPLIT)).toMatchObject({ ok: false, reason: 'split' });
});

it('split: as first block refused', () => {
  startRequest(editor, 'rv', 'x');
  const it = mk(editor, 'replace', 0, SPLIT, 'opv', 'rv');
  addItem(editor, it);
  expect(liveCheck(editor, it)).toMatchObject({ ok: false, reason: 'split' });
});

it('split: label over 80 chars refused', () => {
  expect(checkInsert(editor, 1, '<!-- split: ' + 'x'.repeat(81) + ' -->')).toMatchObject({ ok: false, reason: 'split' });
});

it('split: two valid suggestions each adding a split: first accepted, second refused', () => {
  editor.destroy();
  editor = createEditor(['A', 'B', 'C', 'D'].join(NL));
  startRequest(editor, 'rv', 'x');
  addItem(editor, mk(editor, 'insert', 0, SPLIT, 'op1', 'rv'));
  addItem(editor, mk(editor, 'insert', 2, SPLIT, 'op2', 'rv'));
  expect(acceptItem(editor, 'op1').ok).toBe(true);
  expect(acceptItem(editor, 'op2')).toMatchObject({ ok: false, reason: 'split' });
});

it('mcq: valid accepted', () => {
  expect(checkInsert(editor, 1, MCQ_OK).ok).toBe(true);
});

it('mcq: one option never becomes an MCQ node (parses as paragraph + list)', () => {
  const md = ['Q', '- [x] only'].join(String.fromCharCode(10));
  const res = checkInsert(editor, 1, md);
  if (res.ok) {
    acceptItem(editor, 'opv');
    let mcqs = 0;
    editor.state.doc.descendants((n) => { if (n.type.name === 'mcq') mcqs++; });
    expect(mcqs).toBe(0);
  } else {
    expect(res.reason).toBe('mcq');
  }
});

it('mcq: no ticked option refused', () => {
  expect(checkInsert(editor, 1, ['Q', '- [ ] a', '- [ ] b'].join(String.fromCharCode(10)))).toMatchObject({ ok: false, reason: 'mcq' });
});

it('mcq: duplicate option text refused', () => {
  expect(checkInsert(editor, 1, ['Q', '- [x] same', '- [ ] same'].join(String.fromCharCode(10)))).toMatchObject({ ok: false, reason: 'mcq' });
});

it('acceptAll with replace + insert + delete + move: one undo restores exactly', () => {
  editor.destroy();
  editor = createEditor(['A1', 'B2', 'C3', 'D4'].join(NL));
  startRequest(editor, 'rm', 'x');
  addItem(editor, mk(editor, 'replace', 0, 'A9', 'op1', 'rm'));
  addItem(editor, mk(editor, 'insert', 1, 'B2b', 'op2', 'rm'));
  addItem(editor, mk(editor, 'delete', 2, undefined, 'op3', 'rm'));
  const b3 = blocks(editor)[3];
  addItem(editor, { opId: 'op4', kind: 'move', from: b3.from, to: b3.to, anchorPos: blocks(editor)[0].from, baseHash: b3.hash, markdown: 'D4', flags: [], status: 'pending', requestId: 'rm' });
  const before = docJSON(editor);
  const res = acceptAll(editor);
  expect(res.applied).toBe(4);
  expect(docJSON(editor)).not.toBe(before);
  editor.commands.undo();
  expect(docJSON(editor)).toBe(before);
});

});
