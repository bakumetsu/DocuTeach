import { useEffect, useState, useCallback } from 'react';
import { Dialog } from './Dialog';
import { api } from '../../api';
import { useApp } from '../../state/store';
import { restoreCheckpoint, type Checkpoint } from '../../files/fileActions';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CheckpointsDialog({ open, onClose }: Props) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [deleted, setDeleted] = useState<Record<string, Checkpoint>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setDeleted({});
      const list = await api.docs.checkpoints.list('draft');
      if (!cancelled) {
        setCheckpoints(list);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleDelete = useCallback(async (cp: Checkpoint) => {
    try {
      await api.docs.checkpoints.remove('draft', cp.id);
    } catch (e: unknown) {
      useApp.getState().showToast(
        'Checkpoint action failed: ' + (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    // Only update UI state after the remove succeeded
    setCheckpoints((prev) => prev.filter((c) => c.id !== cp.id));
    setDeleted((prev) => ({ ...prev, [cp.id]: cp }));
  }, []);

  const handleUndoDelete = useCallback(async (cp: Checkpoint) => {
    try {
      await api.docs.checkpoints.create('draft', cp.name, cp.markdown);
    } catch (e: unknown) {
      useApp.getState().showToast(
        'Checkpoint action failed: ' + (e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    // Create succeeded – safe to remove from the deleted list
    setDeleted((prev) => {
      const next = { ...prev };
      delete next[cp.id];
      return next;
    });
    try {
      const list = await api.docs.checkpoints.list('draft');
      setCheckpoints(list);
    } catch (e: unknown) {
      useApp.getState().showToast(
        'Checkpoint action failed: ' + (e instanceof Error ? e.message : String(e)),
      );
    }
  }, []);

  const handleRestore = useCallback(
    async (cp: Checkpoint) => {
      try {
        await restoreCheckpoint(cp);
      } catch (e: unknown) {
        useApp.getState().showToast(
          'Checkpoint action failed: ' + (e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      onClose();
    },
    [onClose],
  );

  const formatDate = (iso: string) => new Date(iso).toLocaleString();

  const deletedEntries = Object.values(deleted);
  const isEmpty = checkpoints.length === 0 && deletedEntries.length === 0;

  return (
    <Dialog open={open} title="Checkpoints" onClose={onClose}>
      {isEmpty ? (
        <p>No checkpoints yet</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {checkpoints.map((cp) => (
            <li key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span style={{ flex: 1 }}>{cp.name}</span>
              <span style={{ color: 'var(--muted, #888)', fontSize: '0.85em' }}>
                {formatDate(cp.createdAt)}
              </span>
              <button onClick={() => handleRestore(cp)}>Restore</button>
              <button onClick={() => handleDelete(cp)}>Delete</button>
            </li>
          ))}
          {deletedEntries.map((cp) => (
            <li key={`del-${cp.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', opacity: 0.6 }}>
              <span style={{ flex: 1 }}>Deleted · {cp.name}</span>
              <button onClick={() => handleUndoDelete(cp)}>Undo</button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
