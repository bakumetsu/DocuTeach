import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OfflineNotice } from '../src/assistant/OfflineNotice';
import { api } from '../src/api';
import { noteStreamError, clearAiNotice } from '../src/assistant/aiNotice';

vi.mock('../src/api', () => ({
  api: { status: vi.fn() },
}));

const mockStatus = vi.mocked(api.status);

describe('OfflineNotice', () => {
  afterEach(() => {
    cleanup();
    clearAiNotice();
    vi.clearAllMocks();
  });

  it('hidden while online', async () => {
    mockStatus.mockResolvedValue({ llm: 'online', model: 'm', version: '1' });
    render(<OfflineNotice />);
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('shown when offline', async () => {
    mockStatus.mockResolvedValue({ llm: 'offline', model: null, version: '1' });
    render(<OfflineNotice />);
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
    });
  });

  it('clicking Retry with status now online hides it', async () => {
    mockStatus
      .mockResolvedValueOnce({ llm: 'offline', model: null, version: '1' })
      .mockResolvedValueOnce({ llm: 'online', model: 'm', version: '1' });
    render(<OfflineNotice />);
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('status rejecting shows it', async () => {
    mockStatus.mockRejectedValue(new Error('network'));
    render(<OfflineNotice />);
    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
    });
  });

  it('noteStreamError llm_offline shows AI offline bar; Retry hides it', async () => {
    mockStatus.mockResolvedValue({ llm: 'online', model: 'm', version: '1' });
    render(<OfflineNotice />);
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    act(() => {
      noteStreamError('llm_offline');
    });
    expect(screen.getByRole('status').textContent).toContain('AI offline');
    mockStatus.mockResolvedValue({ llm: 'online', model: 'm', version: '1' });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('noteStreamError llm_busy and chat_busy show busy text; clearAiNotice hides', async () => {
    mockStatus.mockResolvedValue({ llm: 'online', model: 'm', version: '1' });
    render(<OfflineNotice />);
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    act(() => {
      noteStreamError('llm_busy');
    });
    expect(screen.getByRole('status').textContent).toContain(
      'AI is busy, try again in a moment',
    );
    act(() => {
      noteStreamError('chat_busy');
    });
    expect(screen.getByRole('status').textContent).toContain(
      'AI is busy, try again in a moment',
    );
    act(() => {
      clearAiNotice();
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('polling: offline status re-checks every 15s; online hides bar', async () => {
    vi.useFakeTimers();
    try {
      mockStatus.mockResolvedValue({ llm: 'offline', model: null, version: '1' });
      render(<OfflineNotice />);
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(mockStatus).toHaveBeenCalledTimes(2);
      mockStatus.mockResolvedValue({ llm: 'online', model: 'm', version: '1' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
