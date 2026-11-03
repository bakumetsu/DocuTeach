import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { api } from '../src/api';
import { useApp } from '../src/state/store';
import { extensions } from '../src/editor/extensions';
import { insertFragment } from '../src/editor/insert';
import { parseMarkdown } from '../src/markdown/parse';
import { docToMarkdown } from '../src/editor/docio';
import { useAiNotice, noteStreamError, clearAiNotice } from '../src/assistant/aiNotice';

function createEditor(content?: object) {
  const el = document.createElement('div');
  const editor = new Editor({
    element: el,
    extensions: extensions,
    content: content ?? parseMarkdown('First paragraph\n\nSecond paragraph').doc.toJSON(),
  });
  return editor;
}

describe('insertFragment checkpoint', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useApp.setState({ lessonId: 'L1' });
    createSpy = vi
      .spyOn(api.docs.checkpoints, 'create')
      .mockResolvedValue({ id: 'cp1', name: '', createdAt: '', markdown: '' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checkpoint option calls create with lessonId, name, before-markdown, {auto:true}', () => {
    const editor = createEditor();
    const before = docToMarkdown(editor);

    insertFragment(editor, 'Hello', null, { checkpoint: 'Before AI: /ccq' });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith('L1', 'Before AI: /ccq', before, { auto: true });

    editor.destroy();
  });

  it('one undo step restores the document to its pre-insert state', () => {
    const editor = createEditor();
    const before = docToMarkdown(editor);

    insertFragment(editor, 'Hello', null, { checkpoint: 'Before AI: /ccq' });

    editor.commands.undo();
    expect(docToMarkdown(editor)).toBe(before);

    editor.destroy();
  });

  it('without the checkpoint option, create is not called', () => {
    const editor = createEditor();

    insertFragment(editor, 'Hello', null);

    expect(createSpy).not.toHaveBeenCalled();

    editor.destroy();
  });

  it('when create rejects, insert still succeeds and toast is shown after microtask flush', async () => {
    createSpy.mockRejectedValue(new Error('500'));
    const showToast = vi.fn();
    useApp.setState({ showToast });

    const editor = createEditor();
    const result = insertFragment(editor, 'Hello', null, { checkpoint: 'Before AI: /ccq' });

    expect(result.ok).toBe(true);

    await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith('Checkpoint not saved');

    editor.destroy();
  });

  it('empty markdown with checkpoint creates nothing', () => {
    const editor = createEditor();

    insertFragment(editor, '', null, { checkpoint: 'Before AI: /ccq' });

    expect(createSpy).not.toHaveBeenCalled();

    editor.destroy();
  });

  describe('aiNotice', () => {
    it('noteStreamError maps error codes to notice values', () => {
      noteStreamError('llm_offline');
      expect(useAiNotice.getState().notice).toBe('offline');

      noteStreamError('llm_busy');
      expect(useAiNotice.getState().notice).toBe('busy');

      noteStreamError('chat_busy');
      expect(useAiNotice.getState().notice).toBe('busy');

      noteStreamError(undefined);
      expect(useAiNotice.getState().notice).toBeNull();
    });

    it('clearAiNotice resets notice to null', () => {
      noteStreamError('llm_offline');
      expect(useAiNotice.getState().notice).toBe('offline');

      clearAiNotice();
      expect(useAiNotice.getState().notice).toBeNull();
    });
  });
});
