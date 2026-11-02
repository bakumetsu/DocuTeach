import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OfflineNotice } from '../src/assistant/OfflineNotice';
import { api } from '../src/api';

vi.mock('../src/api', () => ({
  api: { status: vi.fn() },
}));

const mockStatus = vi.mocked(api.status);

describe('OfflineNotice', () => {
  afterEach(() => {
    cleanup();
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
});
