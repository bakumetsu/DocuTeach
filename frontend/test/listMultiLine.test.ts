import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { EditorKeymaps } from '../src/editor/keymaps';
import { SplitGuard } from '../src/editor/guards';
import { parseMarkdown } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';
import { toggleList } from '../src/editor/formatting';

let editor: Editor;

afterEach(() => {
  editor?.destroy();
});

function createEditor(md: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...extensions, EditorKeymaps, SplitGuard],
    content: parseMarkdown(md).doc.toJSON(),
  });
}

type Part = string | 'BR';

function p(...parts: Part[]) {
  return {
    type: 'paragraph',
    content: parts.map((x) => (x === 'BR' ? { type: 'hardBreak' } : { type: 'text', text: x })),
  };
}

function make(blocks: JSONContent[]): Editor {
  const ed = createEditor('x');
  ed.commands.setContent({ type: 'doc', content: blocks });
  return ed;
}

function items(ed: Editor, list: string): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name === 'listItem') out.push(n.textContent);
    return true;
  });
  expect(ed.state.doc.firstChild!.type.name).toBe(list);
  return out;
}

function selectBody(ed: Editor) {
  ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });
}

describe.each([
  ['bullet', 'bulletList'],
  ['ordered', 'orderedList'],
] as const)('toggleList %s over several lines', (kind, name) => {
  it('3 separate paragraphs become 3 items and toggle back', () => {
    editor = make([p('one'), p('two'), p('three')]);
    selectBody(editor);
    expect(toggleList(editor, kind)).toBe(true);
    expect(items(editor, name)).toEqual(['one', 'two', 'three']);
    selectBody(editor);
    toggleList(editor, kind);
    expect(editor.state.doc.childCount).toBe(3);
    expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
  });

  it('one paragraph with hard breaks becomes separate items and toggles back', () => {
    editor = make([p('one', 'BR', 'two', 'BR', 'three')]);
    selectBody(editor);
    expect(toggleList(editor, kind)).toBe(true);
    expect(items(editor, name)).toEqual(['one', 'two', 'three']);
    selectBody(editor);
    toggleList(editor, kind);
    expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');
  });

  it('Select all over mixed blocks converts every block', () => {
    editor = make([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      p('a', 'BR', 'b'),
      p('c'),
    ]);
    editor.commands.selectAll();
    expect(toggleList(editor, kind)).toBe(true);
    expect(items(editor, name)).toEqual(['Title', 'a', 'b', 'c']);
  });

  it('is one undo step', () => {
    editor = make([p('one'), p('two', 'BR', 'three')]);
    const before = editor.state.doc.toJSON();
    editor.commands.selectAll();
    toggleList(editor, kind);
    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});

describe('toggleList keeps custom inline content', () => {
  it('blanks survive the Markdown round-trip', () => {
    editor = createEditor('He {{goes}} home\\\nShe {{runs}} fast');
    editor.commands.selectAll();
    toggleList(editor, 'bullet');
    expect(serializeMarkdown(editor.state.doc)).toBe('- He {{goes}} home\n- She {{runs}} fast\n');
  });
});

describe('toggleList off touches only the selected items', () => {
  const item = (t: string) => ({ type: 'listItem', content: [p(t)] });
  const list = (type: string, ts: string[]) => ({ type, content: ts.map(item) });
  const names = (ed: Editor) =>
    ed.state.doc.content.content.map((n) =>
      n.type.name === 'paragraph' ? `p:${n.textContent}` : `${n.type.name}:${n.textContent}`,
    );
  function caretIn(ed: Editor, word: string) {
    let at = 0;
    ed.state.doc.descendants((n, pos) => {
      if (n.isText && n.text!.includes(word)) at = pos + 1;
      return true;
    });
    ed.commands.setTextSelection(at);
  }

  it('cursor in a middle item splits the list around it', () => {
    editor = make([list('bulletList', ['a', 'b', 'c', 'd', 'e'])]);
    caretIn(editor, 'c');
    expect(toggleList(editor, 'bullet')).toBe(true);
    expect(names(editor)).toEqual(['bulletList:ab', 'p:c', 'bulletList:de']);
  });

  it('selection over items 2-3 of 5', () => {
    editor = make([list('bulletList', ['a', 'b', 'c', 'd', 'e'])]);
    let from = 0;
    let to = 0;
    editor.state.doc.descendants((n, pos) => {
      if (n.isText && n.text === 'b') from = pos + 1;
      if (n.isText && n.text === 'c') to = pos + 1;
      return true;
    });
    editor.commands.setTextSelection({ from, to });
    toggleList(editor, 'bullet');
    expect(names(editor)).toEqual(['bulletList:a', 'p:b', 'p:c', 'bulletList:de']);
  });

  it('ordered tail keeps its numbering', () => {
    editor = make([list('orderedList', ['a', 'b', 'c'])]);
    caretIn(editor, 'a');
    toggleList(editor, 'ordered');
    expect(names(editor)).toEqual(['p:a', 'orderedList:bc']);
    expect(editor.state.doc.child(1).attrs.start).toBe(2);
  });

  it('Select all over a whole list turns every item off', () => {
    editor = make([list('bulletList', ['a', 'b', 'c'])]);
    editor.commands.selectAll();
    toggleList(editor, 'bullet');
    expect(names(editor)).toEqual(['p:a', 'p:b', 'p:c']);
  });
});
