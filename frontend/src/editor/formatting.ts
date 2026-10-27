import type { Editor } from '@tiptap/core';
import { step } from './commands';

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
  };
}
