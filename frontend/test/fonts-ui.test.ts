import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { EditorKeymaps } from '../src/editor/keymaps';
import { SplitGuard } from '../src/editor/guards';
import { parseMarkdown } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';
import {
  setFont,
  setSize,
  stepSize,
  selectionStyle,
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

describe('font and size controls', () => {
  it('setFont applies font to selection', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    setFont(editor, 'Roboto');
    expect(toMd(editor)).toContain('[world]{font="Roboto"}');
    const style = selectionStyle(editor);
    expect(style.font).toBe('Roboto');
    expect(style.size).toBe(null);
  });

  it('setSize then setFont keeps both attributes', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    setSize(editor, 14);
    setFont(editor, 'Merriweather');
    expect(toMd(editor)).toContain('[world]{font="Merriweather" size=14}');
  });

  it('setFont(null) removes font but keeps size; setSize(null) removes mark', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    setFont(editor, 'Roboto');
    setSize(editor, 14);
    expect(toMd(editor)).toContain('[world]{font="Roboto" size=14}');

    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    setFont(editor, null);
    expect(toMd(editor)).toContain('[world]{size=14}');
    expect(toMd(editor)).not.toContain('font=');

    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    setSize(editor, null);
    expect(toMd(editor).trim()).toBe('hello world');
  });

  it('mixed selection reports "mixed" for size', () => {
    editor = createEditor('a [b]{size=14} c');
    editor.commands.selectAll();
    const style = selectionStyle(editor);
    expect(style.size).toBe('mixed');
    const state = formatState(editor);
    expect(state.size).toBe('mixed');
  });

  it('canonical font name: lowercase input writes canonical case', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    setFont(editor, 'roboto');
    expect(toMd(editor)).toContain('[world]{font="Roboto"}');
  });

  it('setSize is one undo step', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    setSize(editor, 14);
    expect(toMd(editor)).toContain('{size=14}');
    editor.commands.undo();
    expect(toMd(editor).trim()).toBe('hello world');
  });

  it('empty selection stores a mark applied on next insert', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(5);
    setSize(editor, 18);

    const marks = editor.state.storedMarks;
    expect(marks).not.toBeNull();
    expect(marks!.length).toBeGreaterThan(0);
    const mark = marks!.find(m => m.type.name === 'fontStyle');
    expect(mark).toBeDefined();
    expect(mark!.attrs.size).toBe(18);

    editor.commands.insertContent('X');
    expect(toMd(editor)).toContain('{size=18}');
  });

  it('stepSize steps through presets and uses fallback', () => {
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));

    stepSize(editor, 1, 12);
    expect(selectionStyle(editor).size).toBe(14);

    stepSize(editor, 1, 12);
    expect(selectionStyle(editor).size).toBe(16);

    stepSize(editor, -1, 12);
    expect(selectionStyle(editor).size).toBe(14);

    // Fresh editor, no prior size, step down from fallback 12
    editor.destroy();
    editor = createEditor('hello world');
    editor.commands.setTextSelection(rangeOf(editor, 'world'));
    stepSize(editor, -1, 12);
    expect(selectionStyle(editor).size).toBe(11);
  });

  it('multi-block selectAll styles all blocks in one transaction', () => {
    editor = createEditor('one\n\ntwo');
    editor.commands.selectAll();
    setSize(editor, 20);
    expect(toMd(editor)).toContain('[one]{size=20}');
    expect(toMd(editor)).toContain('[two]{size=20}');
    editor.commands.undo();
    expect(toMd(editor).trim()).toBe('one\n\ntwo');
  });

  it('setFont works inside a heading', () => {
    editor = createEditor('# Title');
    editor.commands.selectAll();
    setFont(editor, 'Open Sans');
    expect(toMd(editor)).toContain('{font="Open Sans"}');
  });

  it('paste mapping via HTML: valid fonts and sizes preserved, others stripped', () => {
    editor = createEditor('');
    const html = '<p><span style="font-family: Arial, sans-serif; font-size: 14pt">p</span><span style="font-family: Comic Sans MS; font-size: 13pt">q</span><span style="font-family: Zapf">r</span></p>';
    editor.commands.insertContent(html);
    const md = toMd(editor);
    expect(md).toContain('[p]{font="Arial" size=14}');
    expect(md).not.toContain('Comic');
    expect(md).not.toContain('Zapf');
    expect(md).not.toContain('13');
  });
});
