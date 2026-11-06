import { useEffect, useState, useCallback } from 'react';
import { Dialog } from './Dialog';
import { api } from '../../api';
import { useApp } from '../../state/store';
import { Plus, Star, Power, Pencil, Trash2, Save } from 'lucide-react';
import type { ManagedModel, ModelForm } from '../../api/types';
import { ApiError } from '../../api/types';
import { ModelEditForm } from './ModelEditForm';

interface Props {
  open: boolean;
  onClose: () => void;
}

type View = 'list' | 'edit';

const BLANK_FORM: ModelForm = {
  id: '',
  model_path: '',
  parallel: 1,
  ctx_per_chat: 8192,
  reasoning: false,
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  min_p: 0.05,
  ttl: 300,
};

type TransientStatus =
  | { kind: 'removed'; label: string }
  | { kind: 'entry_unreadable'; id: string };

export function ModelsDialog({ open, onClose }: Props) {
  const [view, setView] = useState<View>('list');
  const [models, setModels] = useState<ManagedModel[]>([]);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<ModelForm>(BLANK_FORM);
  const [editEditing, setEditEditing] = useState(false);
  const [status, setStatus] = useState<TransientStatus | null>(null);
  const [overlayDir, setOverlayDir] = useState('');
  const [dirInput, setDirInput] = useState('');
  const [dirState, setDirState] = useState<'idle' | 'checking' | 'ready' | 'hint'>('idle');

  const loadModels = useCallback(async () => {
    try {
      const result = await api.models.manage();
      setModels(result.models);
      setOverlayError(result.overlayError);
      setOverlayDir(result.overlayDir);
    } catch (e: unknown) {
      useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setStatus(null);
      setView('list');
      setEditInitial(BLANK_FORM);
      setEditEditing(false);
      try {
        const result = await api.models.manage();
        if (!cancelled) {
          setModels(result.models);
          setOverlayError(result.overlayError);
          setOverlayDir(result.overlayDir);
          setDirInput(result.overlayDir);
        }
      } catch (e: unknown) {
        useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open]);

  // --- LIST actions ---

  const handleAdd = useCallback(() => {
    setEditInitial(BLANK_FORM);
    setEditEditing(false);
    setStatus(null);
    setView('edit');
  }, []);

  const handleSetDefault = useCallback(async (id: string) => {
    try {
      await api.models.setDefault(id);
      await loadModels();
    } catch (e: unknown) {
      useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [loadModels]);

  const handleUnload = useCallback(async (id: string) => {
    try {
      await api.models.unload(id);
      await loadModels();
    } catch (e: unknown) {
      useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [loadModels]);

  const handleEdit = useCallback(async (id: string) => {
    try {
      const form = await api.models.customGet(id);
      setEditInitial(form);
      setEditEditing(true);
      setStatus(null);
      setView('edit');
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'entry_unreadable') {
        setStatus({ kind: 'entry_unreadable', id });
      } else {
        useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }, []);

  const handleRemove = useCallback(async (id: string, label: string) => {
    try {
      await api.models.customRemove(id);
      setStatus({ kind: 'removed', label });
      await loadModels();
    } catch (e: unknown) {
      useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [loadModels]);

  const handleUndo = useCallback(async () => {
    try {
      await api.models.customUndo();
      setStatus(null);
      setOverlayError(null);
      await loadModels();
    } catch (e: unknown) {
      useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [loadModels]);

  const handleEntryRemoveAndAdd = useCallback(async (id: string) => {
    try {
      await api.models.customRemove(id);
      setStatus(null);
      await loadModels();
      setEditInitial({ ...BLANK_FORM, id });
      setEditEditing(false);
      setView('edit');
    } catch (e: unknown) {
      useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [loadModels]);

  const handleEntryCancel = useCallback(() => {
    setStatus(null);
  }, []);

  // --- EDIT actions ---

  const handleEditSaved = useCallback(async () => {
    setView('list');
    await loadModels();
  }, [loadModels]);

  const handleEditCancel = useCallback(() => {
    setView('list');
  }, []);

  const handleSaveDir = useCallback(async () => {
    try {
      await api.models.setOverlayDir(dirInput.trim());
    } catch (e: unknown) {
      useApp.getState().showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    await loadModels();
    // visible? poll the server list for up to 10 s (design 6.4)
    setDirState('checking');
    const ids = (await api.models.manage()).models.map((m) => m.id);
    const deadline = Date.now() + 10000;
    for (;;) {
      try {
        const listed = new Set((await api.models.list()).map((m) => m.id));
        if (ids.every((id) => listed.has(id))) { setDirState('ready'); return; }
      } catch { /* server busy; retry */ }
      if (Date.now() >= deadline) break;
      await new Promise((res) => setTimeout(res, 1000));
    }
    setDirState('hint');
  }, [dirInput, loadModels]);

  // --- Render ---

  return (
    <Dialog open={open} title="Models" onClose={onClose}>
      {view === 'list' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={handleAdd} aria-label="Add model" title="Add model">
              <Plus size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              aria-label="Extra-config folder"
              placeholder="llama-swap extra-config folder"
              value={dirInput}
              onChange={(e) => setDirInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={handleSaveDir} aria-label="Save folder" title="Save folder">
              <Save size={16} />
            </button>
          </div>
          {overlayDir === '' && (
            <p role="status">Set llama-swap&apos;s extra-config folder once so added models show up.</p>
          )}
          {dirState === 'checking' && <p role="status">Checking&hellip;</p>}
          {dirState === 'ready' && <p role="status">Ready</p>}
          {dirState === 'hint' && (
            <p role="status">llama-swap has not picked up the folder yet. Point its extra-config at it, then save again.</p>
          )}
          {models.length === 0 && !overlayError ? (
            <p>No models</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {models.map((m) => (
                <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {m.label}
                    {m.sizeGb > 0 && (
                      <span style={{ color: 'var(--muted, #888)', fontSize: '0.85em', marginLeft: 6 }}>
                        {m.sizeGb.toFixed(1)} GB
                      </span>
                    )}
                    <span style={{ color: 'var(--muted, #888)', fontSize: '0.85em', marginLeft: 6 }}>
                      {m.state}
                    </span>
                    {m.isDefault && (
                      <span style={{ color: 'var(--muted, #888)', fontSize: '0.75em', marginLeft: 4 }}>
                        default
                      </span>
                    )}
                    {m.source === 'added' && (
                      <span style={{ color: 'var(--muted, #888)', fontSize: '0.75em', marginLeft: 4 }}>
                        added
                      </span>
                    )}
                  </span>
                  <button
                    aria-label="Set default"
                    title="Set default"
                    disabled={m.isDefault}
                    onClick={() => handleSetDefault(m.id)}
                  >
                    <Star size={16} />
                  </button>
                  {m.state === 'loaded' && (
                    <button
                      aria-label="Unload"
                      title="Unload"
                      onClick={() => handleUnload(m.id)}
                    >
                      <Power size={16} />
                    </button>
                  )}
                  {m.source === 'added' && (
                    <>
                      <button
                        aria-label="Edit model"
                        title="Edit"
                        onClick={() => handleEdit(m.id)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        aria-label="Remove model"
                        title="Remove"
                        onClick={() => handleRemove(m.id, m.label)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {overlayError && (
            <div role="status" style={{ marginTop: 8 }}>
              Your added models file is broken: {overlayError}{' '}
              <button onClick={handleUndo}>Undo</button>
            </div>
          )}
          {status?.kind === 'removed' && (
            <div role="status" style={{ marginTop: 8 }}>
              Removed &ldquo;{status.label}&rdquo;{' '}
              <button onClick={handleUndo}>Undo</button>
            </div>
          )}
          {status?.kind === 'entry_unreadable' && (
            <div role="status" style={{ marginTop: 8 }}>
              This model entry cannot be read{' '}
              <button onClick={() => handleEntryRemoveAndAdd(status.id)}>Remove and add again</button>{' '}
              <button onClick={handleEntryCancel}>Cancel</button>
            </div>
          )}
        </>
      )}

      {view === 'edit' && (
        <ModelEditForm
          initial={editInitial}
          editing={editEditing}
          onSaved={handleEditSaved}
          onCancel={handleEditCancel}
        />
      )}
    </Dialog>
  );
}
