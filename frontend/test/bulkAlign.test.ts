import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { EditorKeymaps } from '../src/editor/keymaps';
import { SplitGuard } from '../src/editor/guards';
import { parseMarkdown } from '../src/markdown/parse';
import { setAlign, canAlign, setFont } from '../src/editor/formatting';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node } from '@tiptap/pm/model';

let editor: Editor;

function createEditor(md: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...extensions, EditorKeymaps, SplitGuard],
    content: parseMarkdown(md).doc.toJSON(),
  });
}

function findTextRange(doc: Node, word: string): { from: number; to: number } {
  let result = { from: 0, to: 0 };
  doc.descendants((node, pos) => {
    if (node.isText && node.text === word) {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
}

function getFontStyleAttrs(
  doc: Node,
  word: string,
): { font: string | null; size: number | null } | null {
  let result: { font: string | null; size: number | null } | null = null;
  doc.descendants((node) => {
    if (node.isText && node.text === word) {
      const mark = node.marks.find((m) => m.type.name === 'fontStyle');
      if (mark) {
        result = {
          font: (mark.attrs.font as string | null) ?? null,
          size: (mark.attrs.size as number | null) ?? null,
        };
      }
      return false;
    }
    return true;
  });
  return result;
}

function getParagraphAlign(doc: Node, text: string): string | null {
  let align: string | null = null;
  doc.descendants((node) => {
    if (node.type.name === 'paragraph' && node.isBlock && node.textContent === text) {
      align = (node.attrs.align as string) ?? null;
      return false;
    }
    return true;
  });
  return align;
}

function pressModA(ed: Editor): boolean {
  const ev = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
  return !!ed.view.someProp('handleKeyDown', (f) => f(ed.view, ev));
}

afterEach(() => {
  editor?.destroy();
});

describe('bulk align on paragraphs', () => {
  it('setAlign center on p1-p3: those aligned center, p4 left; one undo reverts', () => {
    editor = createEditor('p1\n\np2\n\np3\n\np4');
    const p1 = findTextRange(editor.state.doc, 'p1');
    const p3 = findTextRange(editor.state.doc, 'p3');
    editor.commands.setTextSelection({ from: p1.from, to: p3.to });

    expect(canAlign(editor)).toBe(true);
    const before = editor.state.doc.toJSON();

    setAlign(editor, 'center');

    const doc = editor.state.doc;
    expect(getParagraphAlign(doc, 'p1')).toBe('center');
    expect(getParagraphAlign(doc, 'p2')).toBe('center');
    expect(getParagraphAlign(doc, 'p3')).toBe('center');
    expect(getParagraphAlign(doc, 'p4')).toBe('left');

    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});

describe('Mod-a select all table cells', () => {
  const tableMd = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';

  it('Mod-a selects all 9 cells; second Mod-a returns false', () => {
    editor = createEditor(tableMd);
    const a = findTextRange(editor.state.doc, 'a');
    editor.commands.setTextSelection(a.from);

    const result = pressModA(editor);
    expect(result).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);

    let cellCount = 0;
    (editor.state.selection as CellSelection).forEachCell(() => {
      cellCount++;
    });
    expect(cellCount).toBe(9);

    pressModA(editor);
    expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
  });
});

describe('setFont after Mod-a on table', () => {
  const tableMd = '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';
  const cellTexts = ['a', 'b', 'c', '1', '2', '3', '4', '5', '6'];

  it('setFont Arial on all 9 cells; one undo reverts', () => {
    editor = createEditor(tableMd);
    const a = findTextRange(editor.state.doc, 'a');
    editor.commands.setTextSelection(a.from);
    pressModA(editor);

    const before = editor.state.doc.toJSON();
    setFont(editor, 'Arial');

    const doc = editor.state.doc;
    for (const text of cellTexts) {
      expect(getFontStyleAttrs(doc, text)).toEqual({ font: 'Arial', size: null });
    }

    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});
