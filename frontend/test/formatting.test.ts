import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { EditorKeymaps } from '../src/editor/keymaps';
import { SplitGuard } from '../src/editor/guards';
import { parseMarkdown } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';
import {
  toggleFormat,
  setBlock,
  toggleList,
  canAlign,
  setAlign,
  currentAlign,
  insertTable,
  tableOp,
  inTable,
  formatState,
} from '../src/editor/formatting';

let editor: Editor;

function createEditor(md: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...extensions, EditorKeymaps, SplitGuard],
    content: parseMarkdown(md).doc.toJSON(),
  });
}

function toMd(ed: Editor): string {
  return serializeMarkdown(ed.state.doc);
}

function docJson(ed: Editor): unknown {
  return ed.state.doc.toJSON();
}

function rangeOf(editor: Editor, word: string): { from: number; to: number } {
  let result = { from: 0, to: 0 };
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text!.includes(word)) {
      const index = node.text!.indexOf(word);
      result = { from: pos + index, to: pos + index + word.length };
      return false;
    }
    return true;
  });
  return result;
}

afterEach(() => {
  editor?.destroy();
});

describe('toggleFormat', () => {
  it('bold: toggles on and off', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    const result = toggleFormat(editor, 'bold');
    expect(result).toBe(true);
    expect(toMd(editor)).toContain('**world**');

    // toggle off
    const result2 = toggleFormat(editor, 'bold');
    expect(result2).toBe(true);
    expect(toMd(editor)).toBe('hello world\n');
  });

  it('underline: produces [word]{.u}', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    const result = toggleFormat(editor, 'underline');
    expect(result).toBe(true);
    expect(toMd(editor)).toContain('[world]{.u}');
  });

  it('highlight: produces ==word==', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    const result = toggleFormat(editor, 'highlight');
    expect(result).toBe(true);
    expect(toMd(editor)).toContain('==world==');
  });

  it('bold is one undo step', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    const before = docJson(editor);
    toggleFormat(editor, 'bold');
    expect(toMd(editor)).toContain('**world**');
    editor.commands.undo();
    expect(docJson(editor)).toEqual(before);
  });
});

describe('setBlock', () => {
  it('h2: converts paragraph to heading', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    const result = setBlock(editor, 'h2');
    expect(result).toBe(true);
    expect(toMd(editor)).toBe('## hello world\n');
  });

  it('is one undo step', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    const before = docJson(editor);
    setBlock(editor, 'h2');
    editor.commands.undo();
    expect(docJson(editor)).toEqual(before);
  });
});

describe('toggleList', () => {
  it('ordered: converts to ordered list', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    const result = toggleList(editor, 'ordered');
    expect(result).toBe(true);
    expect(toMd(editor)).toBe('1. hello world\n');
  });

  it('is one undo step', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    const before = docJson(editor);
    toggleList(editor, 'ordered');
    editor.commands.undo();
    expect(docJson(editor)).toEqual(before);
  });
});

describe('align', () => {
  it('setAlign center on top-level paragraph', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    expect(canAlign(editor)).toBe(true);
    const result = setAlign(editor, 'center');
    expect(result).toBe(true);
    expect(toMd(editor)).toContain('::: {.center}');
    expect(currentAlign(editor)).toBe('center');
  });

  it('setAlign is one undo step', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    const before = docJson(editor);
    setAlign(editor, 'center');
    editor.commands.undo();
    expect(docJson(editor)).toEqual(before);
  });

  it('setAlign on paragraph inside list item returns false', () => {
    editor = createEditor('- hello world');
    // Place cursor inside the paragraph (inside listItem)
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    expect(canAlign(editor)).toBe(false);
    const before = docJson(editor);
    const result = setAlign(editor, 'center');
    expect(result).toBe(false);
    expect(docJson(editor)).toEqual(before);
  });

  it('setAlign on paragraph inside teacher note returns false', () => {
    // Teacher note is a container block; paragraph inside it has depth > 1
    editor = createEditor('::: teacher\nhello world\n:::');
    // Place cursor inside the paragraph within the teacher note
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size);
    expect(text).toContain('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    expect(canAlign(editor)).toBe(false);
    const before = docJson(editor);
    const result = setAlign(editor, 'center');
    expect(result).toBe(false);
    expect(docJson(editor)).toEqual(before);
  });
});

describe('tables', () => {
  it('insertTable(2,3) creates 2 rows of 3 cells with header row', () => {
    editor = createEditor('hello');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    const result = insertTable(editor, 2, 3);
    expect(result).toBe(true);
    expect(inTable(editor)).toBe(true);

    const doc = editor.state.doc;
    const table = doc.firstChild;
    expect(table).not.toBeNull();
    expect(table!.type.name).toBe('table');
    expect(table!.childCount).toBe(2);

    const row0 = table!.child(0);
    expect(row0.childCount).toBe(3);
    // First row cells should be tableHeader
    for (let i = 0; i < 3; i++) {
      expect(row0.child(i).type.name).toBe('tableHeader');
    }

    const row1 = table!.child(1);
    expect(row1.childCount).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(row1.child(i).type.name).toBe('tableCell');
    }
  });

  it('tableOp addRow increases row count', () => {
    editor = createEditor('hello');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    insertTable(editor, 2, 3);
    const rowsBefore = editor.state.doc.firstChild!.childCount;
    const result = tableOp(editor, 'addRow');
    expect(result).toBe(true);
    const rowsAfter = editor.state.doc.firstChild!.childCount;
    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  it('tableOp deleteTable removes the table', () => {
    editor = createEditor('hello');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    insertTable(editor, 2, 3);
    expect(inTable(editor)).toBe(true);
    const result = tableOp(editor, 'deleteTable');
    expect(result).toBe(true);
    expect(inTable(editor)).toBe(false);
  });

  it('insertTable is one undo step', () => {
    editor = createEditor('hello');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    const before = docJson(editor);
    insertTable(editor, 2, 3);
    editor.commands.undo();
    expect(docJson(editor)).toEqual(before);
  });

  it('tableOp addRow is one undo step', () => {
    editor = createEditor('hello');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    insertTable(editor, 2, 3);
    const before = docJson(editor);
    tableOp(editor, 'addRow');
    editor.commands.undo();
    expect(docJson(editor)).toEqual(before);
  });

  it('tableOp deleteTable is one undo step', () => {
    editor = createEditor('hello');
    editor.commands.setTextSelection(rangeOf(editor, 'hello'));
    insertTable(editor, 2, 3);
    const before = docJson(editor);
    tableOp(editor, 'deleteTable');
    editor.commands.undo();
    expect(docJson(editor)).toEqual(before);
  });
});

describe('formatState', () => {
  it('reports bold true when caret is inside bold text', () => {
    editor = createEditor('**bold** and normal');
    const caret = rangeOf(editor, 'bold').from;
    editor.commands.setTextSelection({ from: caret, to: caret });
    const state = formatState(editor);
    expect(state.bold).toBe(true);
  });

  it('reports correct block and canAlign for top-level paragraph', () => {
    editor = createEditor('hello world');
    const caret = rangeOf(editor, 'hello').from;
    editor.commands.setTextSelection({ from: caret, to: caret });
    const state = formatState(editor);
    expect(state.block).toBe('paragraph');
    expect(state.canAlign).toBe(true);
    expect(state.align).toBe('left');
    expect(state.inTable).toBe(false);
  });

  it('reports correct block for heading', () => {
    editor = createEditor('## hello');
    const caret = rangeOf(editor, 'hello').from;
    editor.commands.setTextSelection({ from: caret, to: caret });
    const state = formatState(editor);
    expect(state.block).toBe('h2');
    expect(state.canAlign).toBe(true);
  });
});
