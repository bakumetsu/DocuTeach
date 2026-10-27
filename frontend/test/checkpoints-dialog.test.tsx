import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CheckpointsDialog } from '../src/ui/dialogs/CheckpointsDialog';
import { api } from '../src/api';
import { restoreCheckpoint } from '../src/files/fileActions';
import type { Checkpoint } from '../src/api/types';

afterEach(cleanup);

vi.mock('../src/api', () => ({
  api: {
    docs: {
      checkpoints: {
        list: vi.fn(),
        create: vi.fn(),
        remove: vi.fn(),
      },
    },
  },
}));

vi.mock('../src/files/fileActions', () => ({
  restoreCheckpoint: vi.fn(),
}));

const cp1: Checkpoint = { id: '1', name: 'First', createdAt: '2025-01-01T10:00:00Z', markdown: '# A' };
const cp2: Checkpoint = { id: '2', name: 'Second', createdAt: '2025-01-02T11:00:00Z', markdown: '# B' };

describe('CheckpointsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists two checkpoints', async () => {
    vi.mocked(api.docs.checkpoints.list).mockResolvedValue([cp1, cp2]);

    render(<CheckpointsDialog open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
    });
  });

  it('Delete shows the Undo row', async () => {
    vi.mocked(api.docs.checkpoints.list).mockResolvedValue([cp1, cp2]);
    vi.mocked(api.docs.checkpoints.remove).mockResolvedValue(undefined);

    render(<CheckpointsDialog open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
    });

    const deleteBtns = screen.getAllByText('Delete');
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Deleted/)).toBeTruthy();
      expect(screen.getByText('Undo')).toBeTruthy();
    });
  });

  it('Undo brings the checkpoint back', async () => {
    vi.mocked(api.docs.checkpoints.list)
      .mockResolvedValueOnce([cp1, cp2])
      .mockResolvedValueOnce([cp1, cp2]);
    vi.mocked(api.docs.checkpoints.remove).mockResolvedValue(undefined);
    vi.mocked(api.docs.checkpoints.create).mockResolvedValue(cp1);

    render(<CheckpointsDialog open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
    });

    const deleteBtns = screen.getAllByText('Delete');
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('Undo')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Undo'));

    await waitFor(() => {
      expect(api.docs.checkpoints.create).toHaveBeenCalledWith('draft', 'First', '# A');
      expect(screen.getByText('First')).toBeTruthy();
    });
  });

  it('Restore calls restoreCheckpoint and closes', async () => {
    vi.mocked(api.docs.checkpoints.list).mockResolvedValue([cp1, cp2]);
    const onClose = vi.fn();

    render(<CheckpointsDialog open={true} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy();
    });

    const restoreBtns = screen.getAllByText('Restore');
    fireEvent.click(restoreBtns[0]);

    await waitFor(() => {
      expect(restoreCheckpoint).toHaveBeenCalledWith(cp1);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
