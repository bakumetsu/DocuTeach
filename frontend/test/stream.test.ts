import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { mockConfig } from '../src/api/mock/config';
import { api } from '../src/api';
import { useChats, resetChatsForTest } from '../src/assistant/chatStore';
import { useApp } from '../src/state/store';
import { extensions } from '../src/editor/extensions';
import { StreamSlot, isStreaming, getSlot, startPageStream, cancelPageStream } from '../src/editor/stream';
import { insertFragment } from '../src/editor/insert';
import { parseMarkdown } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';

function createEditor(content?: object) {
  const el = document.createElement('div');
  const editor = new Editor({
    element: el,
    extensions: [...extensions, StreamSlot],
    content: content ?? parseMarkdown('First paragraph\n\nSecond paragraph').doc.toJSON(),
  });
  return editor;
}

describe('stream slot', () => {
  beforeEach(() => {
    mockConfig.swapMs = 0;
    mockConfig.loadMs = 0;
    mockConfig.tokenMinMs = 0;
    mockConfig.tokenMaxMs = 1;
    localStorage.clear();
    resetChatsForTest();
  });

  afterEach(() => {
    mockConfig.tokenMinMs = 0;
    mockConfig.tokenMaxMs = 1;
    vi.restoreAllMocks();
  });

  it('(a) COMMIT = ONE UNDO STEP', async () => {
    await useChats.getState().init();
    const editor = createEditor();
    const originalMd = serializeMarkdown(editor.state.doc);

    // Place caret in the first paragraph
    editor.commands.setTextSelection(1);

    startPageStream(editor, { skill: '/ccq' });
    await vi.waitFor(() => expect(isStreaming()).toBe(false), { timeout: 5000 });

    const afterMd = serializeMarkdown(editor.state.doc);
    // The markdown should now contain a teacher note after 'First paragraph'
    expect(afterMd).toContain('First paragraph');
    expect(afterMd).toContain('teacher');
    expect(afterMd).toContain('CCQ');

    // ONE undo restores the original exactly
    editor.commands.undo();
    expect(serializeMarkdown(editor.state.doc)).toBe(originalMd);

    editor.destroy();
  });

  it('(b) POSITION MAPPING: typing before anchor shifts commit position', async () => {
    await useChats.getState().init();
    mockConfig.tokenMinMs = 20;
    mockConfig.tokenMaxMs = 25;

    const editor = createEditor();

    // Caret in first paragraph
    editor.commands.setTextSelection(1);
    startPageStream(editor, { skill: '/ccq' });

    // Wait a tick so the stream has started and the slot exists
    await vi.waitFor(() => expect(isStreaming()).toBe(true));

    // Insert text at the very start of the document (position 1 = inside first para)
    editor.commands.insertContentAt(1, 'XX ');

    await vi.waitFor(() => expect(isStreaming()).toBe(false), { timeout: 5000 });

    const md = serializeMarkdown(editor.state.doc);
    // The note should be after the (now 'XX First paragraph') first paragraph
    // and before 'Second paragraph'
    const firstParaEnd = md.indexOf('XX First paragraph');
    const noteIdx = md.indexOf('teacher');
    const secondParaIdx = md.indexOf('Second paragraph');
    expect(firstParaEnd).toBeGreaterThanOrEqual(0);
    expect(noteIdx).toBeGreaterThan(firstParaEnd);
    expect(secondParaIdx).toBeGreaterThan(noteIdx);

    editor.destroy();
  });

  it('(c) ESC cancels stream, no history, doc unchanged', async () => {
    await useChats.getState().init();
    mockConfig.tokenMinMs = 30;
    mockConfig.tokenMaxMs = 30;

    const editor = createEditor();
    const beforeJson = JSON.stringify(editor.state.doc.toJSON());
    const releaseSpy = vi.spyOn(api.chats, 'release');

    editor.commands.setTextSelection(1);
    startPageStream(editor, { skill: '/ccq' });

    // Wait until the slot is actually present (stream is mid-flight)
    await vi.waitFor(() => expect(getSlot(editor)).not.toBeNull());

    // Press Escape via the keymap plugin (like a real key press)
    const handled = editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(handled).toBe(true);

    expect(isStreaming()).toBe(false);
    expect(getSlot(editor)).toBeNull();
    expect(releaseSpy).toHaveBeenCalledWith('page');

    // Give any in-flight timer a chance to fire; the cancelled stream must
    // not commit or resurrect the card.
    await new Promise((r) => setTimeout(r, 120));

    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(beforeJson);
    expect(getSlot(editor)).toBeNull();

    // Nothing entered history
    expect(editor.can().undo()).toBe(false);

    editor.destroy();
  });

  it('(d) INVALID FRAGMENT FALLBACK', () => {
    const editor = createEditor();

    // Heading + code block → fallback to plain paragraphs
    const r1 = insertFragment(editor, '# A heading\n\n```js\ncode\n```', null);
    expect(r1.fallback).toBe(true);
    expect(r1.ok).toBe(true);

    // No heading or rawBlock nodes should exist in the document
    let hasHeading = false;
    let hasRawBlock = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') hasHeading = true;
      if (node.type.name === 'rawBlock') hasRawBlock = true;
      return true;
    });
    expect(hasHeading).toBe(false);
    expect(hasRawBlock).toBe(false);

    // Valid fragment: paragraph with bold
    const r2 = insertFragment(editor, 'Plain **bold** text', null);
    expect(r2.fallback).toBe(false);
    expect(r2.ok).toBe(true);

    // Verify the inserted paragraph has a bold mark
    const doc = editor.state.doc;
    let foundBold = false;
    doc.descendants((node) => {
      if (node.isText) {
        node.marks.forEach((m) => {
          if (m.type.name === 'bold') foundBold = true;
        });
      }
      return true;
    });
    expect(foundBold).toBe(true);

    // Split marker (block-level, on its own line) → fallback
    const r3 = insertFragment(editor, 'Hello\n\n<!-- split: X -->\n\nWorld', null);
    expect(r3.fallback).toBe(true);

    editor.destroy();
  });

  it('(e) ONE STREAM AT A TIME', async () => {
    await useChats.getState().init();
    mockConfig.tokenMinMs = 50;
    mockConfig.tokenMaxMs = 60;

    const editor = createEditor();
    editor.commands.setTextSelection(1);

    expect(startPageStream(editor, { skill: '/ccq' })).toBe(true);
    await vi.waitFor(() => expect(isStreaming()).toBe(true));

    // Second attempt
    expect(startPageStream(editor, { skill: '/ccq' })).toBe(false);
    expect(useApp.getState().toast).toBe('Wait for the current draft or press Esc');

    // Clean up
    await vi.waitFor(() => expect(isStreaming()).toBe(false), { timeout: 5000 });
    editor.destroy();
  });

  it('(f) ERROR: stream error clears slot, nothing inserted, toast set', async () => {
    await useChats.getState().init();

    const editor = createEditor();
    const beforeMd = serializeMarkdown(editor.state.doc);

    editor.commands.setTextSelection(1);
    startPageStream(editor, { skill: '/ccq', prompt: '[fail]' });

    await vi.waitFor(() => expect(isStreaming()).toBe(false), { timeout: 5000 });

    expect(getSlot(editor)).toBeNull();
    expect(serializeMarkdown(editor.state.doc)).toBe(beforeMd);
    // A toast was set
    expect(useApp.getState().toast).toBeTruthy();

    editor.destroy();
  });
  it('(g) QUICK RESTART: the cancelled stream cleanup does not break the new one', async () => {
    await useChats.getState().init();
    mockConfig.tokenMinMs = 30;
    mockConfig.tokenMaxMs = 30;

    const editor = createEditor();
    const originalMd = serializeMarkdown(editor.state.doc);
    const releaseSpy = vi.spyOn(api.chats, 'release');
    editor.commands.setTextSelection(1);

    expect(startPageStream(editor, { skill: '/ccq' })).toBe(true);
    await vi.waitFor(() => expect(getSlot(editor)).not.toBeNull());
    cancelPageStream(editor);
    expect(isStreaming()).toBe(false);
    releaseSpy.mockClear();

    // Restart straight away, while the first stream is still winding down
    expect(startPageStream(editor, { skill: '/ccq' })).toBe(true);
    // Outlast the first stream's late cleanup
    await new Promise((r) => setTimeout(r, 120));

    // The second stream is still running and its card is intact
    expect(isStreaming()).toBe(true);
    expect(getSlot(editor)).not.toBeNull();
    expect(releaseSpy).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(isStreaming()).toBe(false), { timeout: 5000 });
    expect(getSlot(editor)).toBeNull();
    expect(serializeMarkdown(editor.state.doc)).toContain('CCQ');

    // The second stream was committed once: a single undo restores the original
    editor.commands.undo();
    expect(serializeMarkdown(editor.state.doc)).toBe(originalMd);

    editor.destroy();
  });
});
