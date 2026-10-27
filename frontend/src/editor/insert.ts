import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { parseFragment } from '../markdown/parse';
import { slotKey } from './stream';

export interface InsertResult { ok: boolean; fallback: boolean }

const ALLOWED_TYPES = new Set([
  'teacherNote',
  'paragraph',
  'orderedList',
  'bulletList',
  'mcq',
]);

export function validateFragment(nodes: PMNode[], warnings: string[]): boolean {
  if (warnings.length > 0) return false;
  return nodes.every((n) => ALLOWED_TYPES.has(n.type.name));
}

export function plainParagraphs(editor: Editor, text: string): PMNode[] {
  const schema = editor.schema;
  const paraType = schema.nodes.paragraph;
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return [paraType.create()];
  }
  return lines.map((line) => {
    const textNode = schema.text(line);
    return paraType.create({ align: 'left' }, [textNode]);
  });
}

export function resolveTopLevelPos(editor: Editor, pos: number | null): number {
  const { state } = editor;
  if (pos === null) {
    const $head = state.selection.$head;
    if ($head.depth === 0) return state.doc.content.size;
    return $head.after(1);
  }
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size));
  const $p = state.doc.resolve(clamped);
  if ($p.depth === 0) return clamped;
  return $p.after(1);
}

export function insertFragment(
  editor: Editor,
  markdown: string,
  pos: number | null,
  opts?: { clearSlot?: boolean },
): InsertResult {
  try {
    const { nodes, warnings } = parseFragment(markdown);
    let toInsert: PMNode[];
    let fallback = false;

    if (!validateFragment(nodes, warnings)) {
      toInsert = plainParagraphs(editor, markdown);
      fallback = true;
    } else {
      toInsert = nodes.map((n) => editor.schema.nodeFromJSON(n.toJSON()));
    }

    // Empty validated list (e.g. empty markdown): skip insertion entirely.
    if (toInsert.length === 0) {
      if (opts?.clearSlot) {
        const tr = editor.state.tr.setMeta(slotKey, { type: 'clear' });
        tr.setMeta('addToHistory', false);
        editor.view.dispatch(tr);
      }
      return { ok: true, fallback: false };
    }

    const resolvedPos = resolveTopLevelPos(editor, pos);
    const totalSize = toInsert.reduce((s, n) => s + n.nodeSize, 0);
    const endPos = Math.max(0, resolvedPos + totalSize - 1);

    // Close the previous history group
    editor.view.dispatch(closeHistory(editor.state.tr));

    // Single insert transaction
    const tr = editor.state.tr.insert(resolvedPos, toInsert);
    if (opts?.clearSlot) {
      tr.setMeta(slotKey, { type: 'clear' });
    }
    tr.setSelection(Selection.near(tr.doc.resolve(endPos)));
    tr.scrollIntoView();
    editor.view.dispatch(tr);

    // Close the history group for this step
    editor.view.dispatch(closeHistory(editor.state.tr));

    return { ok: true, fallback };
  } catch {
    if (opts?.clearSlot) {
      try {
        editor.view.dispatch(
          editor.state.tr.setMeta(slotKey, { type: 'clear' }),
        );
      } catch {
        // best-effort; don't mask the original error
      }
    }
    return { ok: false, fallback: false };
  }
}
