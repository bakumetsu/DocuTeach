import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { EditorKeymaps } from '../src/editor/keymaps';
import { SplitGuard } from '../src/editor/guards';
import { parseMarkdown } from '../src/markdown/parse';
import { toggleFormat, setFont, setSize, toggleList } from '../src/editor/formatting';
import { CellSelection } from '@tiptap/pm/tables';
import type { Mark, Node } from '@tiptap/pm/model';

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

function getTextMarks(doc: Node, word: string): readonly Mark[] {
  let marks: readonly Mark[] = [];
  doc.descendants((node) => {
    if (node.isText && node.text === word) {
      marks = node.marks;
      return false;
    }
    return true;
  });
  return marks;
}

function hasMark(marks: readonly Mark[], name: string): boolean {
  return marks.some((m) => m.type.name === name);
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

function docHasNodeType(doc: Node, typeName: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === typeName) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

function selectOneToThree(ed: Editor): void {
  const one = findTextRange(ed.state.doc, 'one');
  const three = findTextRange(ed.state.doc, 'three');
  ed.commands.setTextSelection({ from: one.from, to: three.to });
}

afterEach(() => {
  editor?.destroy();
});

describe('bulk mark/font on lists', () => {
  const bulletMd = '- one\n- two\n- three\n- four';
  const orderedMd = '1. one\n2. two\n3. three\n4. four';
  const markNames = ['bold', 'italic', 'underline', 'highlight'] as const;

  for (const [label, md] of [
    ['bullet', bulletMd],
    ['ordered', orderedMd],
  ] as const) {
    describe(label, () => {
      for (const mark of markNames) {
        it(`toggleFormat ${mark}: items 1-3 marked, item 4 not; one undo removes`, () => {
          editor = createEditor(md);
          selectOneToThree(editor);
          const before = editor.state.doc.toJSON();
          toggleFormat(editor, mark);

          const doc = editor.state.doc;
          expect(hasMark(getTextMarks(doc, 'one'), mark)).toBe(true);
          expect(hasMark(getTextMarks(doc, 'two'), mark)).toBe(true);
          expect(hasMark(getTextMarks(doc, 'three'), mark)).toBe(true);
          expect(hasMark(getTextMarks(doc, 'four'), mark)).toBe(false);

          editor.commands.undo();
          expect(editor.state.doc.toJSON()).toEqual(before);
        });
      }

      it('setFont: items 1-3 have fontStyle mark, item 4 does not; one undo removes', () => {
        editor = createEditor(md);
        selectOneToThree(editor);
        const before = editor.state.doc.toJSON();
        setFont(editor, 'Arial');

        const doc = editor.state.doc;
        expect(getFontStyleAttrs(doc, 'one')).toEqual({ font: 'Arial', size: null });
        expect(getFontStyleAttrs(doc, 'two')).toEqual({ font: 'Arial', size: null });
        expect(getFontStyleAttrs(doc, 'three')).toEqual({ font: 'Arial', size: null });
        expect(getFontStyleAttrs(doc, 'four')).toBeNull();

        editor.commands.undo();
        expect(editor.state.doc.toJSON()).toEqual(before);
      });

      it('setSize: items 1-3 have fontStyle mark, item 4 does not; one undo removes', () => {
        editor = createEditor(md);
        selectOneToThree(editor);
        const before = editor.state.doc.toJSON();
        setSize(editor, 14);

        const doc = editor.state.doc;
        expect(getFontStyleAttrs(doc, 'one')).toEqual({ font: null, size: 14 });
        expect(getFontStyleAttrs(doc, 'two')).toEqual({ font: null, size: 14 });
        expect(getFontStyleAttrs(doc, 'three')).toEqual({ font: null, size: 14 });
        expect(getFontStyleAttrs(doc, 'four')).toBeNull();

        editor.commands.undo();
        expect(editor.state.doc.toJSON()).toEqual(before);
      });
    });
  }
});

describe('toggleList on bullet list', () => {
  const bulletMd = '- one\n- two\n- three\n- four';

  it('toggleList ordered: no bulletList remains, items 1-3 in orderedList; undo restores', () => {
    editor = createEditor(bulletMd);
    selectOneToThree(editor);
    const before = editor.state.doc.toJSON();
    toggleList(editor, 'ordered');

    const doc = editor.state.doc;
    expect(docHasNodeType(doc, 'bulletList')).toBe(false);
    expect(docHasNodeType(doc, 'orderedList')).toBe(true);

    const inOrdered = new Set<string>();
    doc.descendants((node) => {
      if (node.type.name === 'orderedList') {
        node.descendants((child) => {
          if (child.isText && child.text) inOrdered.add(child.text);
          return true;
        });
      }
      return true;
    });
    expect(inOrdered.has('one')).toBe(true);
    expect(inOrdered.has('two')).toBe(true);
    expect(inOrdered.has('three')).toBe(true);

    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});

describe('bulk edit on 3x3 table', () => {
  const tableMd =
    '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |';
  const cellTexts = ['a', 'b', 'c', '1', '2', '3', '4', '5', '6'];

  function selectAllCells(ed: Editor): void {
    const positions: number[] = [];
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        positions.push(pos);
      }
      return true;
    });
    const sel = CellSelection.create(
      ed.state.doc,
      positions[0],
      positions[positions.length - 1],
    );
    ed.view.dispatch(ed.state.tr.setSelection(sel));
  }

  it('toggleFormat bold: every cell bolded; one undo reverts', () => {
    editor = createEditor(tableMd);
    selectAllCells(editor);
    const before = editor.state.doc.toJSON();
    toggleFormat(editor, 'bold');

    const doc = editor.state.doc;
    for (const text of cellTexts) {
      expect(hasMark(getTextMarks(doc, text), 'bold')).toBe(true);
    }

    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it('setFont: every cell has fontStyle with font; one undo reverts', () => {
    editor = createEditor(tableMd);
    selectAllCells(editor);
    const before = editor.state.doc.toJSON();
    setFont(editor, 'Arial');

    const doc = editor.state.doc;
    for (const text of cellTexts) {
      expect(getFontStyleAttrs(doc, text)).toEqual({ font: 'Arial', size: null });
    }

    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it('setSize: every cell has fontStyle with size; one undo reverts', () => {
    editor = createEditor(tableMd);
    selectAllCells(editor);
    const before = editor.state.doc.toJSON();
    setSize(editor, 14);

    const doc = editor.state.doc;
    for (const text of cellTexts) {
      expect(getFontStyleAttrs(doc, text)).toEqual({ font: null, size: 14 });
    }

    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});
