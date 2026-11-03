import { create } from 'zustand';

export const useAiNotice = create<{
  notice: 'offline' | 'busy' | null;
  set: (n: 'offline' | 'busy' | null) => void;
}>((set) => ({
  notice: null,
  set: (n) => set({ notice: n }),
}));

export function noteStreamError(code?: string): void {
  if (code === 'llm_offline') {
    useAiNotice.getState().set('offline');
  } else if (code === 'llm_busy' || code === 'chat_busy') {
    useAiNotice.getState().set('busy');
  } else {
    useAiNotice.getState().set(null);
  }
}

export function clearAiNotice(): void {
  useAiNotice.getState().set(null);
}
