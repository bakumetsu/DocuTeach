import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ModelsDialog } from '../src/ui/dialogs/ModelsDialog';
import { api } from '../src/api';

afterEach(cleanup);

vi.mock('../src/api', () => ({
  api: {
    models: {
      manage: vi.fn(),
      list: vi.fn(),
      setOverlayDir: vi.fn(),
    },
  },
}));

const FOLDER = String.raw`D:\cfg`;

describe('ModelsDialog overlay folder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the setup hint while no folder is set', async () => {
    vi.mocked(api.models.manage).mockResolvedValue({ models: [], overlayError: null, overlayDir: '' });
    render(<ModelsDialog open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/extra-config folder once/)).toBeTruthy());
  });

  it('saves the folder and reports Ready when the models are listed', async () => {
    vi.mocked(api.models.manage).mockResolvedValue({ models: [], overlayError: null, overlayDir: FOLDER });
    vi.mocked(api.models.setOverlayDir).mockResolvedValue();
    vi.mocked(api.models.list).mockResolvedValue([]);
    render(<ModelsDialog open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText(/extra-config folder once/)).toBeNull());
    fireEvent.click(screen.getByLabelText('Save folder'));
    await waitFor(() => expect(api.models.setOverlayDir).toHaveBeenCalledWith(FOLDER));
    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy());
  });
});
