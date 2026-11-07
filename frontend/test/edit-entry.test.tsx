import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { parseMarkdown } from '../src/markdown/parse';
import { getSuggestState } from '../src/editor/suggest/plugin';
import { extensions } from '../src/editor/extensions';
import { SuggestCardExtension } from '../src/editor/suggest/card';
import { acceptAllDisabled } from '../src/editor/ReviewBar';
import { useApp } from '../src/state/store';
import { useChats, resetChatsForTest } from '../src/assistant/chatStore';
import { useEditEntry, effectiveScope } from '../src/assistant/editEntry';
import { startPageEdit } from '../src/editor/suggest/edit';
import { acceptItem, rejectAll } from '../src/editor/suggest/apply';
import { setPageHandlers } from '../src/assistant/pageBridge';
import { api } from '../src/api';
import { mockConfig } from '../src/api/mock/config';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { ChatView } from '../src/assistant/ChatView';

const MD = 'Alpha\n\nBeta\n\nGamma';

const editorExtensions = extensions.some((ext) => ext.name === 'suggestCards')
  ? extensions
  : [...extensions, SuggestCardExtension];

function createEditor(md = MD): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: editorExtensions, content: parseMarkdown(md).doc.toJSON() });
}

const originalConfig = { ...mockConfig };

let editor: Editor;

beforeEach(() => {
  editor = createEditor();
  useApp.setState({ lessonId: 'L1' });
  vi.spyOn(api.docs.checkpoints, 'create').mockResolvedValue({ id: 'cp1', name: '', createdAt: '', markdown: '' });
  mockConfig.swapMs = 0;
  mockConfig.loadMs = 0;
  mockConfig.tokenMinMs = 0;
  mockConfig.tokenMaxMs = 1;
  localStorage.clear();
  resetChatsForTest();
  useEditEntry.setState({ byChat: {}, hasSelection: false, allowProtected: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  editor.destroy();
  document.body.innerHTML = '';
  mockConfig.swapMs = originalConfig.swapMs;
  mockConfig.loadMs = originalConfig.loadMs;
  mockConfig.tokenMinMs = originalConfig.tokenMinMs;
  mockConfig.tokenMaxMs = originalConfig.tokenMaxMs;
});

describe('editEntry store', () => {
  it('effectiveScope is lesson by default', () => {
    expect(effectiveScope('c')).toBe('lesson');
  });

  it('effectiveScope is selection after setHasSelection(true)', () => {
    useEditEntry.getState().setHasSelection(true);
    expect(effectiveScope('c')).toBe('selection');
  });

  it('explicit setScope wins over hasSelection', () => {
    useEditEntry.getState().setHasSelection(true);
    useEditEntry.getState().setScope('c', 'section');
    expect(effectiveScope('c')).toBe('section');
  });

  it('afterRun resets scope to null when lock is false', () => {
    useEditEntry.getState().setScope('c', 'section');
    useEditEntry.getState().setLock('c', false);
    useEditEntry.getState().afterRun('c');
    expect(useEditEntry.getState().byChat['c'].scope).toBeNull();
  });

  it('afterRun keeps scope when lock is true', () => {
    useEditEntry.getState().setScope('c', 'section');
    useEditEntry.getState().setLock('c', true);
    useEditEntry.getState().afterRun('c');
    expect(useEditEntry.getState().byChat['c'].scope).toBe('section');
  });
});

describe('chat send path (edit)', () => {
  it('send with edit on and scope lesson calls runEdit and adds assistant note', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;
    useEditEntry.getState().setOn(chatId, true);
    useEditEntry.getState().setScope(chatId, 'lesson');

    const runEdit = vi.fn(() => true);
    setPageHandlers({ runEdit });

    await useChats.getState().send(chatId, 'Make it shorter');

    expect(runEdit).toHaveBeenCalledWith({ instruction: 'Make it shorter', scope: 'lesson', allowProtected: false, onReply: expect.any(Function) });
    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    const last = chat.messages[chat.messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('Suggestions sent to the lesson');
  });

  it('/edit runs with instruction even when edit mode is off', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    const runEdit = vi.fn(() => true);
    setPageHandlers({ runEdit });

    await useChats.getState().send(chatId, '/edit fix it');

    expect(runEdit).toHaveBeenCalledWith(expect.objectContaining({ instruction: 'fix it' }));
  });

  it('no handler gives "The page is not available for edits"', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;
    useEditEntry.getState().setOn(chatId, true);
    setPageHandlers({});

    await useChats.getState().send(chatId, 'Make it shorter');

    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    const last = chat.messages[chat.messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('The page is not available for edits');
  });

  it('scope resets to default after run when lock is false', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;
    useEditEntry.getState().setOn(chatId, true);
    useEditEntry.getState().setScope(chatId, 'section');
    useEditEntry.getState().setLock(chatId, false);

    const runEdit = vi.fn(() => true);
    setPageHandlers({ runEdit });

    await useChats.getState().send(chatId, 'do something');

    expect(useEditEntry.getState().byChat[chatId].scope).toBeNull();
  });

  it('scope stays after run when lock is true', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;
    useEditEntry.getState().setOn(chatId, true);
    useEditEntry.getState().setScope(chatId, 'section');
    useEditEntry.getState().setLock(chatId, true);

    const runEdit = vi.fn(() => true);
    setPageHandlers({ runEdit });

    await useChats.getState().send(chatId, 'do something');

    expect(useEditEntry.getState().byChat[chatId].scope).toBe('section');
  });
});

describe('startPageEdit', () => {
  it('rewrite it produces 1 replace item ending with (edited)', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'rewrite it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const items = getSuggestState(editor).items;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('replace');
    expect(items[0].markdown).toMatch(/\(edited\)$/);
  });

  it('delete it produces 1 delete item targeting the last block', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'delete it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const items = getSuggestState(editor).items;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('delete');
    // Last block (Gamma) is index 2; its range starts after Alpha and Beta
    expect(items[0].from).toBeGreaterThan(0);
  });

  it('move it produces 1 move item with anchorPos set', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'move it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const items = getSuggestState(editor).items;
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('move');
    expect(items[0].anchorPos).toBeDefined();
    expect(items[0].anchorPos!).toBeGreaterThan(0);
  });

  it('skip it produces 1 skipped entry and no items', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'skip it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const s = getSuggestState(editor);
    expect(s.editSkipped).toHaveLength(1);
    expect(s.items).toHaveLength(0);
  });

  it('reply text is set for the replace case', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'rewrite it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    expect(getSuggestState(editor).reply).toBe('Done: 1 suggestion.');
  });

  it('selection scope streams on chat id page with mode edit', async () => {
    await useChats.getState().init();

    // Select the 'Beta' text node
    let pos = 0;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === 'Beta') {
        pos = p;
      }
      return true;
    });
    editor.commands.setTextSelection({ from: pos, to: pos + 4 });

    const streamSpy = vi.spyOn(api.chat, 'stream');

    startPageEdit(editor, { instruction: 'rewrite it', scope: 'selection', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    expect(streamSpy).toHaveBeenCalled();
    const firstArg = streamSpy.mock.calls[0][0];
    expect(firstArg.chatId).toBe('page');
    expect(firstArg.mode).toBe('edit');
  });
});

describe('second request while suggestions are pending', () => {
  it('keeps the first suggestions and gives every item a unique opId', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'rewrite it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));
    startPageEdit(editor, { instruction: 'delete it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const items = getSuggestState(editor).items;
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.opId)).size).toBe(2);
  });
});

describe('large rewrite', () => {
  it('large rewrite sets largeRewrite and disables acceptAll, but single accept works', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'large rewrite', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const s0 = getSuggestState(editor);
    expect(s0.items).toHaveLength(1);
    expect(s0.items[0].largeRewrite).toBe(true);
    expect(acceptAllDisabled(s0.items, false)).toBe(true);
    rejectAll(editor);

    // A plain replace of a 1-block scope is not large; single accept works
    let pos = 0;
    editor.state.doc.descendants((node, p) => {
      if (node.isText && node.text === 'Beta') pos = p;
    });
    editor.commands.setTextSelection({ from: pos, to: pos + 4 });
    startPageEdit(editor, { instruction: 'rewrite it', scope: 'selection', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const s = getSuggestState(editor);
    expect(s.items).toHaveLength(1);
    // 1-block scope: the half rule does not apply
    expect(s.items[0].largeRewrite).toBeUndefined();
    expect(acceptAllDisabled(s.items, false)).toBe(false);
    const result = acceptItem(editor, s.items[0].opId);
    expect(result.ok).toBe(true);
    expect(getSuggestState(editor).items.find((i) => i.opId === s.items[0].opId)).toBeUndefined();
  });

  it('plain replace of 1 block in a 3-block lesson is NOT largeRewrite', async () => {
    await useChats.getState().init();

    startPageEdit(editor, { instruction: 'rewrite it', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));

    const s = getSuggestState(editor);
    expect(s.items).toHaveLength(1);
    // 1 of 3 is not more than half, and no large_rewrite flag
    expect(acceptAllDisabled(s.items, false)).toBe(false);
  });
});

describe('ChatView', () => {
  afterEach(() => {
    cleanup();
  });

  it('edit toggle is aria-disabled when view is not edit', async () => {
    await useChats.getState().init();
    useApp.setState({ view: 'teacher' });

    render(createElement(ChatView));

    const toggle = screen.getByLabelText('Edit mode');
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
  });

  it('edit toggle in edit view shows scope button cycling lesson to selection to section', async () => {
    await useChats.getState().init();
    useApp.setState({ view: 'edit' });

    render(createElement(ChatView));

    const toggle = screen.getByLabelText('Edit mode');
    expect(toggle.getAttribute('aria-disabled')).toBeNull();

    // Toggle edit on
    fireEvent.click(toggle);

    const scopeBtn = screen.getByLabelText('Edit scope');
    expect(scopeBtn.textContent).toBe('Whole lesson');

    fireEvent.click(scopeBtn);
    expect(scopeBtn.textContent).toBe('Selection');

    fireEvent.click(scopeBtn);
    expect(scopeBtn.textContent).toBe('This section');
  });
});

describe('large rewrite threshold and empty targets', () => {
  function fakeStream(events: (blockIds: string[]) => object[]) {
    return vi.spyOn(api.chat, 'stream').mockImplementation(async function* (req: { edit: { blocks: { id: string; role: string }[] } }) {
      const ids = req.edit.blocks.filter((b: { id: string; role: string }) => b.role === 'edit').map((b: { id: string; role: string }) => b.id);
      for (const ev of events(ids)) yield ev as never;
      yield { type: 'done', edits: 0, skipped: 0, noChange: 0 } as never;
    } as never);
  }

  it('4-block scope with 3 replaced disables Accept all', async () => {
    editor.destroy();
    editor = createEditor('A1\n\nB2\n\nC3\n\nD4');
    await useChats.getState().init();
    fakeStream((ids) =>
      ids.slice(0, 3).map((id: string, i: number) => ({
        type: 'edit', opId: `o${i}`, kind: 'replace', targets: [id], markdown: `X${i}`, flags: [],
      })),
    );
    startPageEdit(editor, { instruction: 'x', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));
    const s = getSuggestState(editor);
    expect(s.items).toHaveLength(3);
    expect(acceptAllDisabled(s.items, false)).toBe(true);
  });

  it('an op with no targets is skipped, never placed', async () => {
    await useChats.getState().init();
    fakeStream(() => [{ type: 'edit', opId: 'o1', kind: 'replace', targets: [], markdown: 'X', flags: [] }]);
    startPageEdit(editor, { instruction: 'x', scope: 'lesson', allowProtected: false });
    await vi.waitFor(() => expect(getSuggestState(editor).running).toBe(false));
    const s = getSuggestState(editor);
    expect(s.items).toHaveLength(0);
    expect(s.editSkipped).toHaveLength(1);
  });
});

describe('edit reply reaches the chat', () => {
  it('onReply gets the model reply after the run', async () => {
    await useChats.getState().init();
    const onReply = vi.fn();
    startPageEdit(editor, { instruction: 'rewrite it', scope: 'lesson', allowProtected: false, onReply });
    await vi.waitFor(() => expect(onReply).toHaveBeenCalledWith('Done: 1 suggestion.'));
  });
});

describe('chat order with an instant edit run', () => {
  it('shows user message, note, then the model reply', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;
    useEditEntry.getState().setOn(chatId, true);
    setPageHandlers({
      runEdit: (r) => {
        r.onReply?.('All verbs changed.');
        return true;
      },
    });
    await useChats.getState().send(chatId, 'Make it shorter');
    const msgs = useChats.getState().chats.find((c) => c.id === chatId)!.messages.slice(-3);
    expect(msgs.map((m) => m.content)).toEqual(['Make it shorter', 'Suggestions sent to the lesson', 'All verbs changed.']);
  });
});
