import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { parseMarkdown } from '../src/markdown/parse';
import { useApp } from '../src/state/store';
import { api } from '../src/api';
import { LessonsDialog } from '../src/ui/dialogs/LessonsDialog';

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
  cleanup();
});

describe('LessonsDialog', () => {
  it('lists lesson titles', async () => {
    await api.lessons.create('Alpha');
    await api.lessons.create('Beta');

    render(<LessonsDialog open onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeDefined();
      expect(screen.getByText('Beta')).toBeDefined();
    });
  });

  it('clicking New lesson calls onClose', async () => {
    const onClose = vi.fn();
    render(<LessonsDialog open onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByLabelText('New lesson')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('New lesson'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('renaming a lesson via input + Enter updates the list', async () => {
    await api.lessons.create('Old Name');
    render(<LessonsDialog open onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Old Name')).toBeDefined();
    });

    const renameButtons = screen.getAllByLabelText('Rename');
    fireEvent.click(renameButtons[0]);

    const input = screen.getByLabelText('Lesson title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('New Name')).toBeDefined();
    });
  });

  it('Escape in the rename input cancels without closing the dialog', async () => {
    const onClose = vi.fn();
    await api.lessons.create('Keep Name');
    render(<LessonsDialog open onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Keep Name')).toBeDefined();
    });

    const renameButtons = screen.getAllByLabelText('Rename');
    fireEvent.click(renameButtons[0]);

    const input = screen.getByLabelText('Lesson title') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByLabelText('Lesson title')).toBeNull();
    expect(screen.getByText('Keep Name')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Delete shows Undo and clicking Undo restores the row', async () => {
    await api.lessons.create('Deletable');
    render(<LessonsDialog open onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Deletable')).toBeDefined();
    });

    const deleteButtons = screen.getAllByLabelText('Delete');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Undo')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Undo'));

    await waitFor(() => {
      expect(screen.getByText('Deletable')).toBeDefined();
    });
  });

  it('Open on another lesson calls onClose and sets useApp lessonId', async () => {
    const onClose = vi.fn();
    const l1 = await api.lessons.create('Current');
    const l2 = await api.lessons.create('Other');

    useApp.setState({ lessonId: l1.id, lessonTitle: 'Current' });

    render(<LessonsDialog open onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Other')).toBeDefined();
    });

    const li = screen.getByText('Other').closest('li')!;
    fireEvent.click(within(li).getByLabelText('Open'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
      expect(useApp.getState().lessonId).toBe(l2.id);
    });
  });
});
