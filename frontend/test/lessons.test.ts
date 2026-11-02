import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { parseMarkdown } from '../src/markdown/parse';
import { docToMarkdown } from '../src/editor/docio';
import { useApp } from '../src/state/store';
import { api } from '../src/api';
import {
  createLesson,
  openLesson,
  renameLesson,
  deleteLesson,
  restoreLesson,
  importMarkdownAsLesson,
} from '../src/files/lessons';
import { openFile } from '../src/files/fileio';

vi.mock('../src/files/fileio', () => ({
  openFile: vi.fn(),
  saveFile: vi.fn(),
  resetFileHandle: vi.fn(),
}));

vi.mock('../src/assistant/chatStore', () => {
  const state = {
    abortAll: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
  };
  const useChats = Object.assign((selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state), { getState: () => state });
  return { useChats };
});

const mockedOpenFile = vi.mocked(openFile);

let editor: Editor;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  editor = new Editor({
    element: document.createElement('div'),
    extensions,
    content: parseMarkdown('Old text').doc.toJSON(),
  });

  useApp.setState({
    editor,
    fileName: 'lesson.md',
    dirty: false,
    lessonId: 'draft',
    lessonTitle: '',
  });
});

afterEach(() => {
  editor.destroy();
});

describe('lessons', () => {
  it('createLesson opens a new lesson and keeps a Before open checkpoint', async () => {
    const oldMarkdown = docToMarkdown(editor);
    const previousId = useApp.getState().lessonId;

    await createLesson();

    expect(useApp.getState().lessonId).not.toBe(previousId);
    expect(docToMarkdown(editor)).toBe('# New lesson\n');

    const checkpoints = await api.docs.checkpoints.list(previousId);
    const beforeOpen = checkpoints.find((cp) => cp.name === 'Before open');
    expect(beforeOpen).toBeDefined();
    expect(beforeOpen?.markdown).toBe(oldMarkdown);
  });

  it('openLesson loads the saved doc and sets title, fileName, dirty=false', async () => {
    const l1 = await api.lessons.create('First');
    const l2 = await api.lessons.create('Second');
    await api.docs.save(l1.id, '# First content\n');
    await api.docs.save(l2.id, '# Second content\n');

    await openLesson(l1.id);

    expect(useApp.getState().lessonId).toBe(l1.id);
    expect(useApp.getState().lessonTitle).toBe('First');
    expect(useApp.getState().fileName).toBe('First.md');
    expect(useApp.getState().dirty).toBe(false);
    expect(docToMarkdown(editor)).toBe('# First content\n');
  });

  it('renameLesson on the current lesson updates lessonTitle and fileName', async () => {
    const info = await api.lessons.create('Old Title');
    await openLesson(info.id, info);

    await renameLesson(info.id, 'New Title');

    expect(useApp.getState().lessonTitle).toBe('New Title');
    expect(useApp.getState().fileName).toBe('New Title.md');
  });

  it('deleteLesson of the current lesson opens another lesson', async () => {
    const l1 = await api.lessons.create('One');
    const l2 = await api.lessons.create('Two');
    await openLesson(l1.id, l1);

    await deleteLesson(l1.id);

    expect(useApp.getState().lessonId).toBe(l2.id);
  });

  it('deleteLesson creates a new lesson when it was the only one', async () => {
    const l1 = await api.lessons.create('Only');
    await openLesson(l1.id, l1);

    await deleteLesson(l1.id);

    expect(useApp.getState().lessonId).not.toBe(l1.id);
    const lessons = await api.lessons.list();
    expect(lessons.length).toBe(1);
  });

  it('restoreLesson brings the deleted lesson back in the list', async () => {
    const l1 = await api.lessons.create('Restore me');
    await api.lessons.remove(l1.id);

    const info = await restoreLesson(l1.id);

    expect(info.id).toBe(l1.id);
    const lessons = await api.lessons.list();
    expect(lessons.some((l) => l.id === l1.id)).toBe(true);
  });

  it('importMarkdownAsLesson creates and opens a lesson from the imported file', async () => {
    mockedOpenFile.mockResolvedValue({ name: 'x.md', text: '# Imported\n' });

    const result = await importMarkdownAsLesson();

    expect(result).toBe(true);
    expect(useApp.getState().lessonTitle).toBe('x');
    expect(docToMarkdown(editor)).toBe('# Imported\n');
  });

  it('importMarkdownAsLesson returns false when openFile gives null', async () => {
    mockedOpenFile.mockResolvedValue(null);

    const result = await importMarkdownAsLesson();

    expect(result).toBe(false);
  });

  it('openLesson keeps the current lesson when the document cannot be loaded', async () => {
    const info = await api.lessons.create('Fail load');
    const spy = vi.spyOn(api.docs, 'load').mockRejectedValueOnce(new Error('boom'));
    const before = useApp.getState().lessonId;

    await expect(openLesson(info.id, info)).rejects.toThrow('boom');

    expect(useApp.getState().lessonId).toBe(before);
    spy.mockRestore();
  });
});
