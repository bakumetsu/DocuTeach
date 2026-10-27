import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { parseMarkdown } from '../src/markdown/parse';
import { docToMarkdown } from '../src/editor/docio';
import { useApp } from '../src/state/store';
import { api } from '../src/api';
import {
  newDocument,
  openDocument,
  saveDocument,
  saveCheckpoint,
  restoreCheckpoint,
  type Checkpoint,
} from '../src/files/fileActions';
import { openFile, saveFile, resetFileHandle } from '../src/files/fileio';
import { askConfirm, askText } from '../src/ui/ConfirmHost';

vi.mock('../src/files/fileio', () => ({
  openFile: vi.fn(),
  saveFile: vi.fn(),
  resetFileHandle: vi.fn(),
}));

vi.mock('../src/ui/ConfirmHost', () => ({
  askConfirm: vi.fn(),
  askText: vi.fn(),
}));

const mockedOpenFile = vi.mocked(openFile);
const mockedSaveFile = vi.mocked(saveFile);
const mockedResetFileHandle = vi.mocked(resetFileHandle);
const mockedAskConfirm = vi.mocked(askConfirm);
const mockedAskText = vi.mocked(askText);

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
  });
});

afterEach(() => {
  editor.destroy();
});

describe('fileActions', () => {
  it('newDocument with dirty=false replaces content and keeps a Before open checkpoint', async () => {
    const oldMarkdown = docToMarkdown(editor);

    await newDocument();

    expect(docToMarkdown(editor)).toBe('# New lesson\n');
    expect(useApp.getState().fileName).toBe('lesson.md');
    expect(useApp.getState().dirty).toBe(false);
    expect(mockedResetFileHandle).toHaveBeenCalled();

    const checkpoints = await api.docs.checkpoints.list('draft');
    const beforeOpen = checkpoints.find((cp) => cp.name === 'Before open');

    expect(beforeOpen).toBeDefined();
    expect(beforeOpen?.markdown).toBe(oldMarkdown);
  });

  it('newDocument with dirty=true and cancelled confirm changes nothing', async () => {
    const oldMarkdown = docToMarkdown(editor);
    useApp.setState({ dirty: true });
    mockedAskConfirm.mockResolvedValue(false);

    await newDocument();

    expect(docToMarkdown(editor)).toBe(oldMarkdown);
    expect(useApp.getState().fileName).toBe('lesson.md');
    expect(useApp.getState().dirty).toBe(true);

    const checkpoints = await api.docs.checkpoints.list('draft');
    expect(checkpoints.some((cp) => cp.name === 'Before open')).toBe(false);
  });

  it('openDocument loads the opened file and updates state', async () => {
    mockedOpenFile.mockResolvedValue({ name: 'x.md', text: '# Opened\n' });

    await openDocument();

    expect(docToMarkdown(editor)).toBe('# Opened\n');
    expect(useApp.getState().fileName).toBe('x.md');
    expect(useApp.getState().dirty).toBe(false);
  });

  it('restoreCheckpoint can be undone with one undo', async () => {
    const beforeRestore = docToMarkdown(editor);
    const cp: Checkpoint = {
      id: 'cp-1',
      name: 'Test checkpoint',
      createdAt: new Date().toISOString(),
      markdown: '# Restored\n',
    };

    restoreCheckpoint(cp);

    expect(docToMarkdown(editor)).toBe('# Restored\n');

    editor.commands.undo();

    expect(docToMarkdown(editor)).toBe(beforeRestore);
  });

  it('saveDocument saves the document and clears dirty', async () => {
    useApp.setState({ fileName: 'old.md', dirty: true });
    mockedSaveFile.mockResolvedValue('out.md');

    await saveDocument();

    expect(mockedSaveFile).toHaveBeenCalledWith(docToMarkdown(editor), 'old.md', false);
    expect(useApp.getState().fileName).toBe('out.md');
    expect(useApp.getState().dirty).toBe(false);
  });

  it('saveCheckpoint creates a named checkpoint with the current markdown', async () => {
    const currentMarkdown = docToMarkdown(editor);
    mockedAskText.mockResolvedValue('My point');

    await saveCheckpoint();

    const checkpoints = await api.docs.checkpoints.list('draft');
    const cp = checkpoints.find((item) => item.name === 'My point');

    expect(cp).toBeDefined();
    expect(cp?.markdown).toBe(currentMarkdown);
  });

  it('saveCheckpoint with a null name creates no checkpoint', async () => {
    mockedAskText.mockResolvedValue(null);

    const before = await api.docs.checkpoints.list('draft');

    await saveCheckpoint();

    const after = await api.docs.checkpoints.list('draft');

    expect(after).toEqual(before);
  });
});
