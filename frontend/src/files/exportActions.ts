import { useApp } from '../state/store';
import { docToMarkdown } from '../editor/docio';
import { api } from '../api';
import { ApiError } from '../api/types';
import type { ExportPart, ExportTarget, ExportWarning } from '../api/types';

let busy = false;

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function runExport(part: ExportPart, only?: ExportTarget): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const { editor, lessonTitle, fileName, showToast } = useApp.getState();
    if (!editor) {
      showToast('No document');
      return;
    }

    const markdown = docToMarkdown(editor);
    const title =
      lessonTitle ||
      (fileName ? fileName.replace(/\.md$/i, '') : '') ||
      'Lesson';

    const warnings: ExportWarning[] = [];
    const seenCodes = new Set<string>();
    const savedNames: string[] = [];

    for (const target of only ? [only] : part.targets) {
      const result = await api.exports.download(markdown, title, target, part.part);
      saveBlob(result.blob, result.filename);
      savedNames.push(result.filename);
      for (const w of result.warnings) {
        if (!seenCodes.has(w.code)) {
          seenCodes.add(w.code);
          warnings.push(w);
        }
      }
    }

    let msg =
      savedNames.length === 1
        ? `Exported ${savedNames[0]}`
        : `Exported ${savedNames.length} files`;
    if (warnings.length > 0) {
      msg += ' — ' + warnings.map((w) => w.message).join('; ');
    }
    showToast(msg);
  } catch (err) {
    const { showToast } = useApp.getState();
    if (err instanceof ApiError) {
      showToast(`Export failed: ${err.message}`);
    } else {
      showToast('Export failed');
    }
  } finally {
    busy = false;
  }
}

export async function loadExportPlan(): Promise<ExportPart[]> {
  const { editor, lessonTitle, fileName, showToast } = useApp.getState();
  if (!editor) {
    showToast('No document');
    return [];
  }

  const markdown = docToMarkdown(editor);
  const title =
    lessonTitle ||
    (fileName ? fileName.replace(/\.md$/i, '') : '') ||
    'Lesson';

  return api.exports.plan(markdown, title);
}
