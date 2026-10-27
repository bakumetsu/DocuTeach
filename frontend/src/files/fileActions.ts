import { useApp } from '../state/store';
import { docToMarkdown, replaceDocument } from '../editor/docio';
import { openFile, saveFile, resetFileHandle } from './fileio';
import { askConfirm, askText } from '../ui/ConfirmHost';
import { api } from '../api';

export interface Checkpoint {
  id: string;
  name: string;
  createdAt: string;
  markdown: string;
}

async function createBeforeOpenCheckpoint(): Promise<void> {
  const { editor } = useApp.getState();
  if (!editor) return;
  await api.docs.checkpoints.create('draft', 'Before open', docToMarkdown(editor));
}

export async function newDocument(): Promise<void> {
  const { editor, dirty, setDirty, setFileName, showToast } = useApp.getState();
  if (!editor) {
    showToast('No document');
    return;
  }

  if (dirty) {
    const ok = await askConfirm('Discard unsaved changes?', 'Discard');
    if (!ok) return;
  }

  await createBeforeOpenCheckpoint();
  replaceDocument(editor, '# New lesson\n');
  resetFileHandle();
  setFileName('lesson.md');
  setDirty(false);
  showToast('New document (Before open checkpoint kept)');
}

export async function openDocument(): Promise<void> {
  const { editor, dirty, setDirty, setFileName, setWarnings, showToast } = useApp.getState();
  if (!editor) {
    showToast('No document');
    return;
  }

  if (dirty) {
    const ok = await askConfirm('Discard unsaved changes?', 'Discard');
    if (!ok) return;
  }

  const opened = await openFile();
  if (!opened) return;

  await createBeforeOpenCheckpoint();
  const warnings = replaceDocument(editor, opened.text);
  setWarnings(warnings);
  setFileName(opened.name);
  setDirty(false);
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
  const { editor, showToast } = useApp.getState();
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

  const list = await api.docs.checkpoints.list('draft');
  const nonExempt = list.filter((cp) => cp.name !== 'Before open');
  if (nonExempt.length >= 50) {
    const ok = await askConfirm('The oldest checkpoint will be removed. Continue?');
    if (!ok) return;
  }

  await api.docs.checkpoints.create('draft', name, docToMarkdown(editor));
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
