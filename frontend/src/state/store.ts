import { create } from 'zustand'
import { loadJson, saveJson } from './persist'

type Theme = 'light' | 'dark'
type View = 'edit' | 'student' | 'teacher'
type SaveState =
  | { kind: 'saved'; at: string }
  | { kind: 'saving' }
  | { kind: 'error'; reason: string }
  | { kind: 'idle' }

interface AppState {
  theme: Theme
  view: View
  assistantWidth: number
  assistantCollapsed: boolean
  saveState: SaveState
  fileName: string
  dirty: boolean
  setTheme: (t: Theme) => void
  setView: (v: View) => void
  setAssistantWidth: (w: number) => void
  setAssistantCollapsed: (c: boolean) => void
  setSaveState: (s: SaveState) => void
  setFileName: (n: string) => void
  setDirty: (d: boolean) => void
}

const MIN_ASSISTANT_WIDTH = 280

export const useApp = create<AppState>((set) => ({
  theme: loadJson<Theme>('theme', 'light'),
  view: 'edit',
  assistantWidth: loadJson<number>('assistantWidth', 380),
  assistantCollapsed: loadJson<boolean>('assistantCollapsed', false),
  saveState: { kind: 'idle' },
  fileName: 'lesson.md',
  dirty: false,

  setTheme: (t) => {
    document.documentElement.dataset.theme = t
    saveJson('theme', t)
    set({ theme: t })
  },
  setView: (v) => set({ view: v }),
  setAssistantWidth: (w) => {
    const clamped = Math.max(MIN_ASSISTANT_WIDTH, w)
    saveJson('assistantWidth', clamped)
    set({ assistantWidth: clamped })
  },
  setAssistantCollapsed: (c) => {
    saveJson('assistantCollapsed', c)
    set({ assistantCollapsed: c })
  },
  setSaveState: (s) => set({ saveState: s }),
  setFileName: (n) => set({ fileName: n }),
  setDirty: (d) => set({ dirty: d }),
}))

export function initTheme(): void {
  const t = loadJson<Theme>('theme', 'light')
  document.documentElement.dataset.theme = t
}
