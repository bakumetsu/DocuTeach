import { saveDocument } from '../files/fileActions';
import { useApp } from '../state/store';
import { revert, redo } from './history';

export function installGlobalKeys(): () => void {
  const handler = (event: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const modKey = isMac ? event.metaKey : event.ctrlKey;

    // Ctrl/Cmd+S → save
    if (modKey && event.key === 's') {
      event.preventDefault();
      void saveDocument().catch((e: unknown) =>
        useApp.getState().showToast(
          'Could not save: ' + (e instanceof Error ? e.message : String(e)),
        ),
      );
      return;
    }

    // Ctrl/Cmd+Z (no shift) → undo; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y → redo
    const isUndo = modKey && !event.shiftKey && event.key === 'z';
    const isRedo = (modKey && event.shiftKey && event.key === 'z') || (modKey && event.key === 'y');

    if (!isUndo && !isRedo) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Inside .page-content → editor keymap handles it
    if (target.closest('.page-content')) return;

    // input / textarea / select / contenteditable outside .page-content → browser default
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((target as HTMLElement).isContentEditable) return;

    // body, toolbar buttons, etc.
    event.preventDefault();
    if (isUndo) revert();
    else redo();
  };

  window.addEventListener('keydown', handler);
  return () => {
    window.removeEventListener('keydown', handler);
  };
}
