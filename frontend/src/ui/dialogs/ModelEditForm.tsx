import { useCallback, useState } from 'react';
import { api } from '../../api';
import { useApp } from '../../state/store';
import { Eye, Check, X } from 'lucide-react';
import type { ModelForm } from '../../api/types';
import { ApiError } from '../../api/types';

interface Props {
  initial: ModelForm;
  editing: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

/** Show at most 2 decimals so 0.7 never reads 0.699999. */
export const fmt2 = (n: number): number => Math.round(n * 100) / 100;

export const roundNums = (f: ModelForm): ModelForm => ({ ...f, parallel: fmt2(f.parallel), ctx_per_chat: fmt2(f.ctx_per_chat), temperature: fmt2(f.temperature), top_p: fmt2(f.top_p), top_k: fmt2(f.top_k), min_p: fmt2(f.min_p), ttl: fmt2(f.ttl) });

type NumKey =
  | 'parallel'
  | 'ctx_per_chat'
  | 'temperature'
  | 'top_p'
  | 'top_k'
  | 'min_p'
  | 'ttl';

const sanitizeId = (val: string) => val.replace(/[^a-z0-9.-]/g, '');

export function ModelEditForm({ initial, editing, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<ModelForm>(() => roundNums(initial));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverPathMissing, setServerPathMissing] = useState(false);
  const [serverPath, setServerPath] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const canSave = form.id.trim() !== '' && form.model_path.trim() !== '';

  const num = (key: NumKey, label: string) => (
    <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span>{label}</span>
      <input
        type="number"
        value={form[key]}
        step="any"
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) } as ModelForm)}
        aria-label={label}
      />
    </label>
  );

  const doSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        await api.models.customEdit(initial.id, form);
      } else {
        await api.models.customAdd(form);
      }
      onSaved();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'model_exists') {
        setSaveError('A model with this id exists');
      } else if (e instanceof ApiError && e.code === 'llama_server_missing') {
        setServerPathMissing(true);
      } else {
        useApp
          .getState()
          .showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      setSaving(false);
    }
  }, [form, editing, initial.id, onSaved]);

  const handleSavePath = useCallback(async () => {
    if (!serverPath.trim()) return;
    try {
      await api.models.setServerPath(serverPath);
      setServerPathMissing(false);
      await doSave();
    } catch (e: unknown) {
      useApp
        .getState()
        .showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [serverPath, doSave]);

  const handlePreview = useCallback(async () => {
    try {
      const { yaml } = await api.models.customPreview(form);
      setPreview(yaml);
    } catch (e: unknown) {
      useApp
        .getState()
        .showToast('Model action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [form]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          ID
          <input
            value={form.id}
            disabled={editing}
            onChange={(e) => setForm({ ...form, id: sanitizeId(e.target.value) })}
            aria-label="ID"
          />
        </label>
        <label style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
          Model path
          <input
            value={form.model_path}
            onChange={(e) => setForm({ ...form, model_path: e.target.value })}
            aria-label="Model path"
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {num('parallel', 'Parallel')}
        {num('ctx_per_chat', 'Ctx / chat')}
        {num('temperature', 'Temperature')}
        {num('top_p', 'Top p')}
        {num('top_k', 'Top k')}
        {num('min_p', 'Min p')}
        {num('ttl', 'TTL')}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={form.reasoning}
          onChange={(e) => setForm({ ...form, reasoning: e.target.checked })}
          aria-label="Reasoning"
        />
        Reasoning
      </label>

      {saveError && (
        <p role="alert" style={{ color: 'var(--error, #c00)', fontSize: '0.85em', margin: 0 }}>
          {saveError}
        </p>
      )}

      {serverPathMissing && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 8,
            border: '1px solid var(--error, #c00)',
            borderRadius: 4,
          }}
        >
          <input
            value={serverPath}
            onChange={(e) => setServerPath(e.target.value)}
            placeholder="llama-server path"
            aria-label="llama-server path"
            style={{ flex: 1 }}
          />
          <button
            onClick={handleSavePath}
            disabled={!serverPath.trim()}
            aria-label="Save server path"
            title="Save server path"
          >
            <Check size={16} />
          </button>
        </div>
      )}

      {preview && (
        <pre
          style={{
            margin: 0,
            padding: 8,
            overflow: 'auto',
            maxHeight: 240,
            fontSize: '0.85em',
            background: 'var(--code-bg, #f4f4f4)',
            borderRadius: 4,
          }}
          aria-readonly="true"
        >
          {preview}
        </pre>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={handlePreview} aria-label="Preview" title="Preview">
          <Eye size={16} />
        </button>
        <button
          onClick={doSave}
          disabled={!canSave || saving}
          aria-label="Save model"
          title="Save"
        >
          <Check size={16} />
        </button>
        <button onClick={onCancel} aria-label="Cancel" title="Cancel">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
