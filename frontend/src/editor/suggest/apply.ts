import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { parseFragment } from '../../markdown/parse';
import { validateFragment, saveAutoCheckpoint, resolveTopLevelPos } from '../insert';
import { docToMarkdown } from '../docio';
import { suggestKey, getSuggestState, rejectItems, undoReject, type Item } from './plugin';
import { hashText, nodeMarkdown } from './snapshot';

const checkpointed = new Set<string>();

// ---------- internal helpers ----------

function blockRangeAt(doc: PMNode, pos: number): { from: number; to: number } | null {
  let start = 0;
  const { content } = doc;
  for (let i = 0; i < content.childCount; i++) {
    const end = start + content.child(i).nodeSize;
    if (pos >= start && pos < end) return { from: start, to: end };
    start = end;
  }
  return null;
}

function rangeHashInDoc(editor: Editor, doc: PMNode, from: number, to: number): string {
  const parts: string[] = [];
  let pos = 0;
  doc.forEach((node) => {
    const end = pos + node.nodeSize;
    if (pos < to && end > from) parts.push(nodeMarkdown(editor, node));
    pos = end;
    return true;
  });
  return hashText(parts.join(''));
}

function checkConstraints(doc: PMNode): string | null {
  let splits = 0;
  let mcqErr: string | null = null;
  doc.descendants((n) => {
    if (n.type.name === 'splitPoint') splits++;
    if (n.type.name === 'mcq' && n.childCount < 2) {
      mcqErr = 'MCQ must have at least 2 options';
      return false;
    }
    return true;
  });
  if (splits > 1) return 'Lesson may contain at most one split point';
  return mcqErr;
}

function buildNodes(editor: Editor, markdown: string, src?: PMNode): PMNode[] {
  const { nodes, warnings } = parseFragment(markdown, { stripStyle: true });
  let out: PMNode[];
  if (warnings.length > 0 || !validateFragment(nodes, warnings)) {
    const pt = editor.schema.nodes.paragraph;
    const lines = markdown.split('\n').filter((l) => l.trim());
    out = lines.length
      ? lines.map((l) => pt.create({ align: src?.attrs.align ?? 'left' }, [editor.schema.text(l)]))
      : [pt.create()];
  } else {
    out = nodes.map((n) => editor.schema.nodeFromJSON(n.toJSON()));
    const align = src?.attrs.align;
    if (align) {
      out = out.map((n) =>
        n.type.spec.attrs && 'align' in n.type.spec.attrs ? n.type.create({ ...n.attrs, align }, n.content) : n,
      );
    }
  }
  return out;
}

function nodeAtPos(doc: PMNode, pos: number): PMNode | null {
  let start = 0;
  const { content } = doc;
  for (let i = 0; i < content.childCount; i++) {
    const node = content.child(i);
    const end = start + node.nodeSize;
    if (pos >= start && pos < end) return node;
    start = end;
  }
  return null;
}

function applyStep(tr: Transaction, editor: Editor, item: Item, nodes: PMNode[]): void {
  switch (item.kind) {
    case 'replace':
      tr.replaceWith(item.from, item.to, nodes);
      break;
    case 'insert': {
      const p = resolveTopLevelPos(editor, item.anchorPos ?? null);
      tr.insert(p, nodes);
      break;
    }
    case 'delete':
      tr.delete(item.from, item.to);
      break;
    case 'move': {
      tr.delete(item.from, item.to);
      const p = resolveTopLevelPos(editor, item.anchorPos ?? null);
      tr.insert(p, nodes);
      break;
    }
  }
}

function doCheckpoint(editor: Editor, requestId: string, requestText: string | null): string | undefined {
  if (checkpointed.has(requestId)) return undefined;
  checkpointed.add(requestId);
  const md = docToMarkdown(editor);
  const name = 'Before AI edit: ' + (requestText ?? '').slice(0, 30);
  saveAutoCheckpoint(name, md);
  return md;
}

// ---------- liveCheck ----------

export type LiveCheckResult = { ok: true } | { ok: false; reason: 'stale' | 'invalid' | 'split' | 'mcq'; message: string };

export function liveCheck(editor: Editor, item: Item): LiveCheckResult {
  return liveCheckDoc(editor, editor.state.doc, item);
}

function liveCheckDoc(editor: Editor, doc: PMNode, item: Item): LiveCheckResult {
  // (1) stale
  let h: string;
  if (item.kind === 'insert' && item.baseHash && item.anchorPos !== undefined) {
    const r = blockRangeAt(doc, item.anchorPos);
    if (!r) return { ok: false, reason: 'stale', message: 'Anchor block not found.' };
    h = rangeHashInDoc(editor, doc, r.from, r.to);
  } else {
    h = rangeHashInDoc(editor, doc, item.from, item.to);
  }
  if (item.baseHash && h !== item.baseHash) {
    return { ok: false, reason: 'stale', message: 'Content in range has changed.' };
  }

  // (2) parse + validate
  if (!item.markdown) return { ok: false, reason: 'invalid', message: 'No content to apply.' };
  const { nodes, warnings } = parseFragment(item.markdown, { stripStyle: true });
  if (warnings.length > 0 || !validateFragment(nodes, warnings)) {
    return { ok: false, reason: 'invalid', message: 'Content failed validation.' };
  }

  // (3) dry-run constraint check
  const checkTr = new Transaction(doc);
  const src = item.kind === 'replace' || item.kind === 'move' ? nodeAtPos(doc, item.from) ?? undefined : undefined;
  const toInsert = buildNodes(editor, item.markdown, src);
  applyStep(checkTr, editor, item, toInsert);
  const err = checkConstraints(checkTr.doc);
  if (err) {
    const reason: 'split' | 'mcq' = err.includes('split') ? 'split' : 'mcq';
    return { ok: false, reason, message: err };
  }

  return { ok: true };
}

// ---------- acceptItem ----------

export function acceptItem(
  editor: Editor,
  opId: string,
): { ok: boolean; reason?: string; message?: string } {
  const state = getSuggestState(editor);
  const item = state.items.find((i) => i.opId === opId);
  if (!item) return { ok: false, reason: 'stale', message: 'Item no longer exists.' };
  if (item.status === 'stale') return { ok: false, reason: 'stale', message: 'Range has changed.' };

  const check = liveCheck(editor, item);
  if (!check.ok) return { ok: false, reason: check.reason, message: check.message };

  doCheckpoint(editor, item.requestId, state.requestText);

  // single undo-step: close → step+meta → close
  editor.view.dispatch(closeHistory(editor.state.tr));

  const src = item.kind === 'replace' || item.kind === 'move' ? nodeAtPos(editor.state.doc, item.from) ?? undefined : undefined;
  const nodes = buildNodes(editor, item.markdown!, src);
  const tr = editor.state.tr;
  applyStep(tr, editor, item, nodes);
  tr.setMeta(suggestKey, { type: 'remove', opIds: [opId] });
  editor.view.dispatch(tr);

  editor.view.dispatch(closeHistory(editor.state.tr));
  return { ok: true };
}

// ---------- acceptAll ----------

export function acceptAll(editor: Editor): { applied: number; left: number } {
  const state = getSuggestState(editor);
  const pending = state.items
    .filter((i) => i.status === 'pending')
    .sort((a, b) => a.from - b.from);

  if (pending.length === 0) return { applied: 0, left: 0 };

  doCheckpoint(editor, pending[0].requestId, state.requestText);

  editor.view.dispatch(closeHistory(editor.state.tr));

  const tr = editor.state.tr;
  const removed: string[] = [];
  let left = 0;

  for (const orig of pending) {
    const from = tr.mapping.map(orig.from, 1);
    const to = tr.mapping.map(orig.to, -1);
    const anchorPos = orig.anchorPos !== undefined ? tr.mapping.map(orig.anchorPos, 1) : undefined;
    const mapped: Item = { ...orig, from, to, anchorPos };

    const check = liveCheckDoc(editor, tr.doc, mapped);
    if (!check.ok) {
      left++;
      continue;
    }

    const src = mapped.kind === 'replace' || mapped.kind === 'move' ? nodeAtPos(tr.doc, from) ?? undefined : undefined;
    const nodes = buildNodes(editor, mapped.markdown!, src);
    applyStep(tr, editor, mapped, nodes);
    removed.push(orig.opId);
  }

  if (removed.length > 0) {
    tr.setMeta(suggestKey, { type: 'remove', opIds: removed });
  }
  editor.view.dispatch(tr);

  editor.view.dispatch(closeHistory(editor.state.tr));
  return { applied: removed.length, left };
}

// ---------- reject / undoReject ----------

export function rejectItem(editor: Editor, opId: string): void {
  rejectItems(editor, [opId]);
}

export function rejectAll(editor: Editor): void {
  const state = getSuggestState(editor);
  const ids = state.items.map((i) => i.opId);
  if (ids.length) rejectItems(editor, ids);
}

export { undoReject };
