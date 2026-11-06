import { useEffect, useState, useCallback } from 'react';
import { Dialog } from './Dialog';
import { api } from '../../api';
import { useApp } from '../../state/store';
import { Plus, Upload, RotateCcw, Pencil, Download, Trash2, Check, X } from 'lucide-react';
import type { SkillDetail, SkillDraft, SkillImportPreview } from '../../api/types';
import { ApiError } from '../../api/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

type View = 'list' | 'edit' | 'import';

interface EditState {
  command: string;
  name: string;
  description: string;
  insertAs: 'teacherNote' | 'blanks' | 'text';
  tag: string;
  body: string;
  editing: boolean;
}

const EMPTY_EDIT: EditState = {
  command: '',
  name: '',
  description: '',
  insertAs: 'teacherNote',
  tag: '',
  body: '',
  editing: false,
};

export function SkillsDialog({ open, onClose }: Props) {
  const [view, setView] = useState<View>('list');
  const [skills, setSkills] = useState<SkillDetail[]>([]);
  const [deleted, setDeleted] = useState<{ command: string; trashId: string } | null>(null);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<SkillImportPreview | null>(null);
  const [importClash, setImportClash] = useState<'rename' | 'replace'>('rename');

  const loadSkills = useCallback(async () => {
    try {
      const list = await api.skills.manage();
      setSkills(list);
    } catch (e: unknown) {
      useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setDeleted(null);
      setView('list');
      setEdit(EMPTY_EDIT);
      setSaveError(null);
      setImportText('');
      setImportPreview(null);
      setImportClash('rename');
      try {
        const list = await api.skills.manage();
        if (!cancelled) {
          setSkills(list);
        }
      } catch (e: unknown) {
        useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // --- LIST actions ---

  const handleNew = useCallback(() => {
    setEdit(EMPTY_EDIT);
    setSaveError(null);
    setView('edit');
  }, []);

  const handleImport = useCallback(() => {
    setImportText('');
    setImportPreview(null);
    setImportClash('rename');
    setView('import');
  }, []);

  const handleRestoreDefaults = useCallback(async () => {
    try {
      await api.skills.restoreDefaults();
      await loadSkills();
    } catch (e: unknown) {
      useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [loadSkills]);

  const handleEdit = useCallback((skill: SkillDetail) => {
    setEdit({
      command: skill.command.replace(/^\//, ''),
      name: skill.name,
      description: skill.description,
      insertAs: (skill.insertAs || 'teacherNote') as 'teacherNote' | 'blanks' | 'text',
      tag: skill.tag,
      body: skill.body,
      editing: true,
    });
    setSaveError(null);
    setView('edit');
  }, []);

  const handleExport = useCallback(async (command: string) => {
    try {
      const { blob, filename } = await api.skills.exportFile(command);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  const handleReset = useCallback(
    async (command: string) => {
      try {
        await api.skills.reset(command);
        await loadSkills();
      } catch (e: unknown) {
        useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    },
    [loadSkills],
  );

  const handleDelete = useCallback(
    async (command: string) => {
      try {
        const { trashId } = await api.skills.remove(command);
        setDeleted({ command, trashId });
        await loadSkills();
      } catch (e: unknown) {
        useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    },
    [loadSkills],
  );

  const handleUndo = useCallback(async () => {
    if (!deleted) return;
    try {
      await api.skills.restore(deleted.trashId);
      setDeleted(null);
      await loadSkills();
    } catch (e: unknown) {
      useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [deleted, loadSkills]);

  // --- EDIT actions ---

  const sanitizeCommand = (val: string) => val.replace(/[^a-z0-9-]/g, '');

  const canSave = edit.command.trim() !== '' && edit.name.trim() !== '' && edit.body.trim() !== '';

  const handleSave = useCallback(async () => {
    const draft: SkillDraft = {
      command: '/' + edit.command,
      name: edit.name,
      description: edit.description,
      insertAs: edit.insertAs,
      tag: edit.tag || null,
      body: edit.body,
      replace: edit.editing,
    };
    try {
      await api.skills.save(draft);
      setView('list');
      await loadSkills();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'skill_exists') {
        setSaveError('A skill with this command exists');
      } else {
        useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }, [edit, loadSkills]);

  const handleCancelEdit = useCallback(() => {
    setView('list');
  }, []);

  // --- IMPORT actions ---

  const handlePreview = useCallback(async () => {
    try {
      const preview = await api.skills.importPreview(importText);
      setImportPreview(preview);
      setImportClash('rename');
    } catch (e: unknown) {
      useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [importText]);

  const handleImportCommit = useCallback(async () => {
    try {
      await api.skills.importCommit(importText, importClash, importPreview?.skill.command);
      setView('list');
      await loadSkills();
    } catch (e: unknown) {
      useApp.getState().showToast('Skill action failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [importText, importClash, importPreview, loadSkills]);

  // --- Render ---

  return (
    <Dialog open={open} title="Skills" onClose={onClose}>
      {view === 'list' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button onClick={handleNew} aria-label="New skill" title="New skill">
              <Plus size={16} />
            </button>
            <button onClick={handleImport} aria-label="Import skill" title="Import skill">
              <Upload size={16} />
            </button>
            <button onClick={handleRestoreDefaults} aria-label="Restore defaults" title="Restore defaults">
              <RotateCcw size={16} />
            </button>
          </div>
          {skills.length === 0 ? (
            <p>No skills</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {skills.map((skill) => (
                <li key={skill.command} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <code>{skill.command}</code>{' '}
                    {skill.name}
                    {skill.description && (
                      <span style={{ color: 'var(--muted, #888)', fontSize: '0.85em', marginLeft: 6 }}>
                        {skill.description}
                      </span>
                    )}
                    <span style={{ color: 'var(--muted, #888)', fontSize: '0.75em', marginLeft: 6 }}>
                      {skill.source}
                    </span>
                    {skill.hidden && (
                      <span style={{ color: 'var(--muted, #888)', fontSize: '0.75em', marginLeft: 4 }}>
                        hidden
                      </span>
                    )}
                    {skill.source === 'broken' && skill.reason && (
                      <span style={{ color: 'var(--error, #c00)', fontSize: '0.85em', marginLeft: 6 }}>
                        {skill.reason}
                      </span>
                    )}
                  </span>
                  <button
                    aria-label="Edit skill"
                    title="Edit"
                    disabled={skill.source === 'broken'}
                    onClick={() => handleEdit(skill)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    aria-label="Export skill"
                    title="Export"
                    onClick={() => handleExport(skill.command)}
                  >
                    <Download size={16} />
                  </button>
                  {skill.source === 'customized' && (
                    <button
                      aria-label="Reset skill"
                      title="Reset"
                      onClick={() => handleReset(skill.command)}
                    >
                      <RotateCcw size={16} />
                    </button>
                  )}
                  {skill.source !== 'builtin' && (
                    <button
                      aria-label="Delete skill"
                      title="Delete"
                      disabled={skill.source === 'broken'}
                      onClick={() => handleDelete(skill.command)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {deleted && (
            <div role="status" style={{ marginTop: 8 }}>
              Deleted &ldquo;{deleted.command}&rdquo;{' '}
              <button onClick={handleUndo}>Undo</button>
            </div>
          )}
        </>
      )}

      {view === 'edit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>
            Command
            <input
              value={edit.command}
              disabled={edit.editing}
              onChange={(e) => setEdit({ ...edit, command: sanitizeCommand(e.target.value) })}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              aria-label="Command"
            />
          </label>
          <label>
            Name
            <input
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              aria-label="Name"
            />
          </label>
          <label>
            Description
            <input
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              aria-label="Description"
            />
          </label>
          <label>
            Insert as
            <select
              value={edit.insertAs}
              onChange={(e) =>
                setEdit({ ...edit, insertAs: e.target.value as 'teacherNote' | 'blanks' | 'text' })
              }
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              aria-label="Insert as"
            >
              <option value="teacherNote">teacherNote</option>
              <option value="blanks">blanks</option>
              <option value="text">text</option>
            </select>
          </label>
          <label>
            Tag
            <input
              value={edit.tag}
              onChange={(e) => setEdit({ ...edit, tag: e.target.value })}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              aria-label="Tag"
            />
          </label>
          <label>
            Body
            <textarea
              value={edit.body}
              onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              rows={10}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              aria-label="Body"
            />
          </label>
          {saveError && (
            <p role="alert" style={{ color: 'var(--error, #c00)', fontSize: '0.85em', margin: 0 }}>
              {saveError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={handleSave}
              disabled={!canSave}
              aria-label="Save skill"
              title="Save"
            >
              <Check size={16} />
            </button>
            <button onClick={handleCancelEdit} aria-label="Cancel" title="Cancel">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {view === 'import' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label>
            Skill text
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={10}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
              aria-label="Skill text"
            />
          </label>
          <button
            onClick={handlePreview}
            disabled={!importText.trim()}
            aria-label="Preview import"
            title="Preview"
          >
            <Upload size={16} /> Preview
          </button>
          {importPreview && (
            <div style={{ fontSize: '0.9em' }}>
              <p style={{ margin: 0 }}>
                <strong>{importPreview.skill.name}</strong>{' '}
                <code>{importPreview.skill.command}</code>
              </p>
              {importPreview.warnings.length > 0 && (
                <ul style={{ listStyle: 'disc', paddingLeft: 16, margin: '4px 0' }}>
                  {importPreview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {importPreview.clash !== null && (
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  <label>
                    <input
                      type="radio"
                      name="clash"
                      checked={importClash === 'rename'}
                      onChange={() => setImportClash('rename')}
                    />{' '}
                    Keep both (rename)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="clash"
                      checked={importClash === 'replace'}
                      onChange={() => setImportClash('replace')}
                    />{' '}
                    Replace existing
                  </label>
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={handleImportCommit}
              disabled={!importPreview}
              aria-label="Import"
              title="Import"
            >
              <Upload size={16} />
            </button>
            <button
              onClick={() => setView('list')}
              aria-label="Cancel"
              title="Cancel"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
