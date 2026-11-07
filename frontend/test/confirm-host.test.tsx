import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ConfirmHost, askText, askConfirm } from '../src/ui/ConfirmHost';

afterEach(cleanup);

describe('ConfirmHost', () => {
  it('OK on the save-checkpoint prompt returns the name and closes the dialog', async () => {
    render(<ConfirmHost />);
    let result: Promise<string | null> | undefined;
    act(() => {
      result = askText('Save checkpoint', 'Name', 'Checkpoint 10:00');
    });
    expect(screen.getByText('Save checkpoint')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await expect(result).resolves.toBe('Checkpoint 10:00');
    await waitFor(() => expect(screen.queryByText('Save checkpoint')).toBeNull());
  });

  it('Cancel on the save-checkpoint prompt returns null and closes the dialog', async () => {
    render(<ConfirmHost />);
    let result: Promise<string | null> | undefined;
    act(() => {
      result = askText('Save checkpoint', 'Name', 'Checkpoint 10:00');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(result).resolves.toBeNull();
    await waitFor(() => expect(screen.queryByText('Save checkpoint')).toBeNull());
  });

  it('confirm prompt closes on OK and on Cancel', async () => {
    render(<ConfirmHost />);
    let ok: Promise<boolean> | undefined;
    act(() => {
      ok = askConfirm('Continue?');
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(ok).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByText('Continue?')).toBeNull());

    let cancel: Promise<boolean> | undefined;
    act(() => {
      cancel = askConfirm('Again?');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(cancel).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByText('Again?')).toBeNull());
  });
});
