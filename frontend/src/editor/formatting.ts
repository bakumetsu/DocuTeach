import type { Editor } from '@tiptap/core';
import { step } from './commands';
import { canonicalFont } from './fontStyle';

export function toggleFormat(
  editor: Editor,
  mark: 'bold' | 'italic' | 'underline' | 'highlight',
): boolean {
  let ok = false;
  step(editor, () => {
    const chain = editor.chain();
    switch (mark) {
      case 'bold':
        ok = chain.toggleBold().run();
        break;
      case 'italic':
        ok = chain.toggleItalic().run();
        break;
      case 'underline':
        ok = chain.toggleUnderline().run();
        break;
      case 'highlight':
        ok = chain.toggleHighlight().run();
        break;
    }
  });
  return ok;
}

export function setBlock(
  editor: Editor,
  kind: 'paragraph' | 'h1' | 'h2',
): boolean {
  let ok = false;
  step(editor, () => {
    const chain = editor.chain();
    switch (kind) {
      case 'paragraph':
        ok = chain.setParagraph().run();
        break;
      case 'h1':
        ok = chain.setHeading({ level: 1 }).run();
        break;
      case 'h2':
        ok = chain.setHeading({ level: 2 }).run();
        break;
    }
  });
  return ok;
}

export function toggleList(
  editor: Editor,
  kind: 'bullet' | 'ordered',
): boolean {
  let ok = false;
  step(editor, () => {
    const chain = editor.chain();
    switch (kind) {
      case 'bullet':
        ok = chain.toggleBulletList().run();
        break;
      case 'ordered':
        ok = chain.toggleOrderedList().run();
        break;
    }
  });
  return ok;
}

export function canAlign(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if ($from.depth !== 1) return false;
  const node = $from.node();
  return node.type.name === 'paragraph' || node.type.name === 'heading';
}

export function setAlign(
  editor: Editor,
  value: 'left' | 'center' | 'right' | 'justify',
): boolean {
  if (!canAlign(editor)) return false;
  let ok = false;
  step(editor, () => {
    const { $from } = editor.state.selection;
    const node = $from.node();
    const chain = editor.chain();
    if (node.type.name === 'paragraph') {
      ok = chain.updateAttributes('paragraph', { align: value }).run();
    } else {
      ok = chain.updateAttributes('heading', { align: value }).run();
    }
  });
  return ok;
}

export function currentAlign(
  editor: Editor,
): 'left' | 'center' | 'right' | 'justify' {
  const { $from } = editor.state.selection;
  const node = $from.node();
  const align = (node.attrs as Record<string, unknown> | null)?.align;
  if (align === 'center' || align === 'right' || align === 'justify') {
    return align;
  }
  return 'left';
}

export function insertTable(editor: Editor, rows = 3, cols = 3): boolean {
  let ok = false;
  step(editor, () => {
    ok = editor
      .chain()
      .insertTable({ rows, cols, withHeaderRow: true })
      .run();
  });
  return ok;
}

export function tableOp(
  editor: Editor,
  op: 'addRow' | 'addColumn' | 'deleteRow' | 'deleteColumn' | 'deleteTable',
): boolean {
  let ok = false;
  step(editor, () => {
    const chain = editor.chain();
    switch (op) {
      case 'addRow':
        ok = chain.addRowAfter().run();
        break;
      case 'addColumn':
        ok = chain.addColumnAfter().run();
        break;
      case 'deleteRow':
        ok = chain.deleteRow().run();
        break;
      case 'deleteColumn':
        ok = chain.deleteColumn().run();
        break;
      case 'deleteTable':
        ok = chain.deleteTable().run();
        break;
    }
  });
  return ok;
}

export function inTable(editor: Editor): boolean {
  return editor.isActive('table');
}

export const SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

export function setFontStyle(
  editor: Editor,
  patch: { font?: string | null; size?: number | null },
): boolean {
  let ok = false;
  step(editor, () => {
    const tr = editor.state.tr;
    const markType = editor.schema.marks.fontStyle;

    if (editor.state.selection.empty) {
      const $from = editor.state.selection.$from;
      const old =
        (editor.state.storedMarks ?? $from.marks()).find(
          (m) => m.type === markType,
        )?.attrs ?? { font: null, size: null };
      const next = {
        font: 'font' in patch ? patch.font ?? null : (old.font as string | null),
        size: 'size' in patch ? patch.size ?? null : (old.size as number | null),
      };
      const marks = (editor.state.storedMarks ?? $from.marks()).filter(
        (m) => m.type !== markType,
      );
      if (next.font !== null || next.size !== null) {
        marks.push(markType.create(next));
      }
      tr.setStoredMarks(marks);
    } else {
      for (const range of editor.state.selection.ranges) {
        const from = range.$from.pos;
        const to = range.$to.pos;
        if (from >= to) continue;

        const segments: {
          segFrom: number;
          segTo: number;
          old: { font: string | null; size: number | null };
        }[] = [];
        const none = { font: null, size: null };

        tr.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isInline) return;
          const segFrom = Math.max(pos, from);
          const segTo = Math.min(pos + node.nodeSize, to);
          const existing = node.marks.find((m) => m.type === markType)?.attrs;
          segments.push({
            segFrom,
            segTo,
            old: existing
              ? {
                  font: (existing.font as string | null) ?? null,
                  size: (existing.size as number | null) ?? null,
                }
              : none,
          });
        });

        for (const seg of segments) {
          const next = {
            font: 'font' in patch ? patch.font ?? null : seg.old.font,
            size: 'size' in patch ? patch.size ?? null : seg.old.size,
          };
          tr.removeMark(seg.segFrom, seg.segTo, markType);
          if (next.font !== null || next.size !== null) {
            tr.addMark(seg.segFrom, seg.segTo, markType.create(next));
          }
        }
      }
    }

    editor.view.dispatch(tr);
    ok = true;
  });
  return ok;
}

export function setFont(editor: Editor, name: string | null): boolean {
  return setFontStyle(editor, { font: name === null ? null : canonicalFont(name) });
}

export function setSize(editor: Editor, n: number | null): boolean {
  return setFontStyle(editor, { size: n });
}

export function selectionStyle(
  editor: Editor,
): { font: string | null | 'mixed'; size: number | null | 'mixed' } {
  if (editor.state.selection.empty) {
    const $from = editor.state.selection.$from;
    const markType = editor.schema.marks.fontStyle;
    const mark = (editor.state.storedMarks ?? $from.marks()).find(
      (m) => m.type === markType,
    );
    if (mark) {
      return {
        font: ((mark.attrs.font as string | null) ?? null),
        size: ((mark.attrs.size as number | null) ?? null),
      };
    }
    return { font: null, size: null };
  }

  const markType = editor.schema.marks.fontStyle;
  const fontSet = new Set<string | null>();
  const sizeSet = new Set<number | null>();
  let found = false;

  for (const range of editor.state.selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    if (from >= to) continue;

    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isInline || node.nodeSize <= 0) return;
      const segFrom = Math.max(pos, from);
      const segTo = Math.min(pos + node.nodeSize, to);
      if (segFrom >= segTo) return;

      found = true;
      const mark = node.marks.find((m) => m.type === markType);
      fontSet.add(mark ? ((mark.attrs.font as string | null) ?? null) : null);
      sizeSet.add(mark ? ((mark.attrs.size as number | null) ?? null) : null);
    });
  }

  if (!found) return { font: null, size: null };

  return {
    font: fontSet.size === 1 ? [...fontSet][0] : 'mixed',
    size: sizeSet.size === 1 ? [...sizeSet][0] : 'mixed',
  };
}

export function stepSize(
  editor: Editor,
  dir: 1 | -1,
  fallback: number,
): boolean {
  const current = selectionStyle(editor);
  const base =
    current.size !== null && typeof current.size === 'number'
      ? current.size
      : fallback;
  const presets = SIZE_PRESETS;

  let next: number;
  if (dir === 1) {
    next = presets.find((p) => p > base) ?? base;
  } else {
    const less = presets.filter((p) => p < base);
    next = less.length > 0 ? less[less.length - 1] : base;
  }

  return setSize(editor, next);
}

export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: boolean;
  bullet: boolean;
  ordered: boolean;
  block: 'paragraph' | 'h1' | 'h2' | 'other';
  align: 'left' | 'center' | 'right' | 'justify';
  inTable: boolean;
  canAlign: boolean;
  canUndo: boolean;
  canRedo: boolean;
  font: string | null | 'mixed';
  size: number | null | 'mixed';
}

export function formatState(editor: Editor): FormatState {
  const { $from } = editor.state.selection;
  const node = $from.node();

  let block: 'paragraph' | 'h1' | 'h2' | 'other' = 'other';
  if (node.type.name === 'paragraph') {
    block = 'paragraph';
  } else if (node.type.name === 'heading') {
    const level = (node.attrs as Record<string, unknown> | null)?.level;
    if (level === 1) block = 'h1';
    else if (level === 2) block = 'h2';
  }

  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    highlight: editor.isActive('highlight'),
    bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'),
    block,
    align: currentAlign(editor),
    inTable: inTable(editor),
    canAlign: canAlign(editor),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    ...selectionStyle(editor),
  };
}
