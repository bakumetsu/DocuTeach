import { create } from 'zustand';
import type { EditScope } from '../api/types';

interface EditEntry {
  on: boolean;
  scope: EditScope | null;
  lock: boolean;
}

interface EditEntryState {
  byChat: Record<string, EditEntry>;
  hasSelection: boolean;
  allowProtected: boolean;
  setOn: (chatId: string, on: boolean) => void;
  setScope: (chatId: string, scope: EditScope | null) => void;
  setLock: (chatId: string, lock: boolean) => void;
  setHasSelection: (b: boolean) => void;
  setAllowProtected: (b: boolean) => void;
  afterRun: (chatId: string) => void;
}

const DEFAULT_ENTRY: EditEntry = { on: false, scope: null, lock: false };

export const useEditEntry = create<EditEntryState>()((set, get) => ({
  byChat: {},
  hasSelection: false,
  allowProtected: false,
  setOn(chatId, on) {
    set((s) => ({
      byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? DEFAULT_ENTRY), on } },
    }));
  },
  setScope(chatId, scope) {
    set((s) => ({
      byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? DEFAULT_ENTRY), scope } },
    }));
  },
  setLock(chatId, lock) {
    set((s) => ({
      byChat: { ...s.byChat, [chatId]: { ...(s.byChat[chatId] ?? DEFAULT_ENTRY), lock } },
    }));
  },
  setHasSelection(b) {
    set({ hasSelection: b });
  },
  setAllowProtected(b) {
    set({ allowProtected: b });
  },
  afterRun(chatId) {
    const entry = get().byChat[chatId];
    if (entry && !entry.lock) {
      set((s) => ({
        byChat: { ...s.byChat, [chatId]: { ...s.byChat[chatId], scope: null } },
      }));
    }
  },
}));

export function getChatEdit(chatId: string): EditEntry {
  return useEditEntry.getState().byChat[chatId] ?? DEFAULT_ENTRY;
}

export function effectiveScope(chatId: string): EditScope {
  const entry = useEditEntry.getState().byChat[chatId];
  return entry?.scope ?? (useEditEntry.getState().hasSelection ? 'selection' : 'lesson');
}
