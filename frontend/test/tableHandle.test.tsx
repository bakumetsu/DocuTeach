import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { EditorKeymaps } from '../src/editor/keymaps';
import { SplitGuard } from '../src/editor/guards';
import { parseMarkdown } from '../src/markdown/parse';
import { selectTableCells, setFont } from '../src/editor/formatting';
import { CellSelection } from '@tiptap/pm/tables';
import type { Node } from '@tiptap/pm/model';
import { TableHandle } from '../src/editor/TableHandle';

let editor: Editor;

const tableMd =
  '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';

function createEditor(md: string, container?: HTMLElement): Editor {
  const el = document.createElement('div');
  if (container) container.appendChild(el);
  return new Editor({
    element: el,
    extensions: [...extensions, EditorKeymaps, SplitGuard],
    content: parseMarkdown(md).doc.toJSON(),
  });
}

function findTextRange(
  doc: Node,
  word: string,
): { from: number; to: number } {
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

afterEach(() => {
  editor?.destroy();
  cleanup();
});

describe('selectTableCells', () => {
  it('selects a CellSelection spanning all 9 cells of a 3x3 table', () => {
    const page = document.createElement('div');
    page.className = 'page';
    document.body.appendChild(page);
    editor = createEditor(tableMd, page);

    const a = findTextRange(editor.state.doc, 'a');
    editor.commands.setTextSelection(a.from);

    const result = selectTableCells(editor, a.from);
    expect(result).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);

    let cellCount = 0;
    (editor.state.selection as CellSelection).forEachCell(() => cellCount++);
    expect(cellCount).toBe(9);

    page.remove();
  });

  it('returns false when cursor is not in a table', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(0);
    expect(selectTableCells(editor)).toBe(false);
  });
});

describe('setFont after selectTableCells', () => {
  it('applies font to all 9 cells', () => {
    editor = createEditor(tableMd);
    const a = findTextRange(editor.state.doc, 'a');
    selectTableCells(editor, a.from);

    setFont(editor, 'Arial');

    const cellTexts = ['a', 'b', 'c', '1', '2', '3', '4', '5', '6'];
    const doc = editor.state.doc;
    for (const text of cellTexts) {
      let found = false;
      doc.descendants((node) => {
        if (node.isText && node.text === text) {
          found = true;
          const mark = node.marks.find((m) => m.type.name === 'fontStyle');
          expect(mark).toBeDefined();
          expect((mark!.attrs.font as string) ?? null).toBe('Arial');
          return false;
        }
        return true;
      });
      expect(found).toBe(true);
    }
  });
});

describe('TableHandle component', () => {
  it('renders handle and clicking selects all 9 cells', () => {
    const page = document.createElement('div');
    page.className = 'page';
    document.body.appendChild(page);
    editor = createEditor(tableMd, page);

    render(<TableHandle editor={editor} />);

    const a = findTextRange(editor.state.doc, 'a');
    act(() => {
      editor.commands.setTextSelection(a.from);
    });

    const handle = screen.getByLabelText('Select table');
    expect(handle).toBeDefined();

    act(() => {
      handle.click();
    });

    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    let cellCount = 0;
    (editor.state.selection as CellSelection).forEachCell(() => cellCount++);
    expect(cellCount).toBe(9);

    page.remove();
  });
});
