import { useApp } from '../state/store';
import { docToMarkdown, replaceDocument } from '../editor/docio';
import { saveFile } from './fileio';
import { askConfirm, askText } from '../ui/ConfirmHost';
import { api } from '../api';
import { createLesson, importMarkdownAsLesson } from './lessons';

export interface Checkpoint {
  id: string;
  name: string;
  createdAt: string;
  markdown: string;
}

export async function newDocument(): Promise<void> {
  await createLesson();
  useApp.getState().showToast('New lesson');
}

export async function openDocument(): Promise<void> {
  const ok = await importMarkdownAsLesson();
  if (ok) useApp.getState().showToast('Imported as a new lesson');
}

export async function saveDocument(forceAs = false): Promise<void> {
  const { editor, fileName, setFileName, setDirty, showToast } = useApp.getState();
  if (!editor) {
    showToast('No document');
    return;
  }

  const name = await saveFile(docToMarkdown(editor), fileName, forceAs);
  if (name) {
    setFileName(name);
    setDirty(false);
    showToast('Saved');
  }
}

export async function saveCheckpoint(): Promise<void> {
  const { editor, lessonId, showToast } = useApp.getState();
  if (!editor) {
    showToast('No document');
    return;
  }

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const defaultName = `Checkpoint ${hh}:${mm}`;

  const name = await askText('Save checkpoint', 'Name', defaultName);
  if (!name) return;

  const list = await api.docs.checkpoints.list(lessonId);
  const nonExempt = list.filter((cp) => cp.name !== 'Before open');
  if (nonExempt.length >= 50) {
    const ok = await askConfirm('The oldest checkpoint will be removed. Continue?');
    if (!ok) return;
  }

  await api.docs.checkpoints.create(lessonId, name, docToMarkdown(editor));
  showToast('Checkpoint saved');
}

export function restoreCheckpoint(cp: Checkpoint): void {
  const { editor, showToast } = useApp.getState();
  if (!editor) {
    showToast('No document');
    return;
  }

  replaceDocument(editor, cp.markdown);
  showToast(`Restored "${cp.name}"`);
}
