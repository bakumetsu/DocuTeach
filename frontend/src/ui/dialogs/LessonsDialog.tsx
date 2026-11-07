import { useEffect, useState, useCallback } from 'react';
import { Dialog } from './Dialog';
import { api } from '../../api';
import { useApp } from '../../state/store';
import { openLesson, createLesson, renameLesson, deleteLesson, restoreLesson } from '../../files/lessons';
import { Plus, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import type { LessonInfo } from '../../api/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LessonsDialog({ open, onClose }: Props) {
  const [lessons, setLessons] = useState<LessonInfo[]>([]);
  const [deleted, setDeleted] = useState<LessonInfo | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const lessonId = useApp((s) => s.lessonId);

  const loadLessons = useCallback(async () => {
    try {
      const list = await api.lessons.list();
      setLessons(list);
    } catch (e: unknown) {
      useApp.getState().showToast(
        'Lesson action failed: ' + (e instanceof Error ? e.message : String(e)),
      );
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setDeleted(null);
      try {
        const list = await api.lessons.list();
        if (!cancelled) {
          setLessons(list);
        }
      } catch (e: unknown) {
        useApp.getState().showToast(
          'Lesson action failed: ' + (e instanceof Error ? e.message : String(e)),
        );
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleCreate = useCallback(async () => {
    try {
      await createLesson();
      onClose();
    } catch (e: unknown) {
      useApp.getState().showToast(
        'Lesson action failed: ' + (e instanceof Error ? e.message : String(e)),
      );
    }
  }, [onClose]);

  const handleOpen = useCallback(
    async (id: string, info: LessonInfo) => {
      try {
        await openLesson(id, info);
        onClose();
      } catch (e: unknown) {
        useApp.getState().showToast(
          'Lesson action failed: ' + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
    [onClose],
  );

  const startRename = useCallback((lesson: LessonInfo) => {
    setRenamingId(lesson.id);
    setRenameValue(lesson.title);
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  const commitRename = useCallback(
    async (id: string) => {
      const value = renameValue.trim();
      const current = lessons.find((l) => l.id === id)?.title;
      if (value === '' || value === current) {
        setRenamingId(null);
        return;
      }
      try {
        await renameLesson(id, value);
        setRenamingId(null);
        await loadLessons();
      } catch (e: unknown) {
        useApp.getState().showToast(
          'Lesson action failed: ' + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
    [renameValue, lessons, loadLessons],
  );

  const handleDelete = useCallback(
    async (lesson: LessonInfo) => {
      try {
        await deleteLesson(lesson.id);
        await loadLessons();
        setDeleted(lesson);
      } catch (e: unknown) {
        useApp.getState().showToast(
          'Lesson action failed: ' + (e instanceof Error ? e.message : String(e)),
        );
      }
    },
    [loadLessons],
  );

  const handleUndo = useCallback(async () => {
    if (!deleted) return;
    try {
      await restoreLesson(deleted.id);
      setDeleted(null);
      await loadLessons();
    } catch (e: unknown) {
      useApp.getState().showToast(
        'Lesson action failed: ' + (e instanceof Error ? e.message : String(e)),
      );
    }
  }, [deleted, loadLessons]);

  const formatDate = (iso: string) => new Date(iso).toLocaleString();

  return (
    <Dialog open={open} title="Lessons" onClose={onClose}>
      <button onClick={() => handleCreate()} aria-label="New lesson" title="New lesson">
        <Plus size={16} />
      </button>
      {lessons.length === 0 ? (
        <p>No lessons yet</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {lessons.map((lesson) => (
            <li key={lesson.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              {renamingId === lesson.id ? (
                <input
                  autoFocus
                  aria-label="Lesson title"
                  data-owns-escape="true"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitRename(lesson.id);
                    } else if (e.key === 'Escape') {
                      cancelRename();
                    }
                  }}
                  onBlur={() => cancelRename()}
                  style={{ flex: 1 }}
                />
              ) : (
                <span style={{ flex: 1 }}>
                  {lesson.title}
                  {lesson.id === lessonId && (
                    <span style={{ color: 'var(--muted, #888)', fontSize: '0.85em', marginLeft: 6 }}>
                      current
                    </span>
                  )}
                </span>
              )}
              <span style={{ color: 'var(--muted, #888)', fontSize: '0.85em' }}>
                {formatDate(lesson.updatedAt)}
              </span>
              <button aria-label="Open" onClick={() => handleOpen(lesson.id, lesson)}>
                <FolderOpen size={16} />
              </button>
              <button aria-label="Rename" onClick={() => startRename(lesson)}>
                <Pencil size={16} />
              </button>
              <button aria-label="Delete" onClick={() => handleDelete(lesson)}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {deleted && (
        <div role="status" style={{ marginTop: 8 }}>
          Deleted &ldquo;{deleted.title}&rdquo;{' '}
          <button onClick={() => handleUndo()}>Undo</button>
        </div>
      )}
    </Dialog>
  );
}
