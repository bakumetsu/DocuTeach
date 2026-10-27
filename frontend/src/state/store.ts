import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import { loadJson, saveJson } from './persist'
import type { Meta } from '../markdown/frontmatter'
import { EMPTY_META } from '../markdown/frontmatter'

type Theme = 'light' | 'dark'
type View = 'edit' | 'student' | 'teacher'
type Dialog = null | 'pageStyle' | 'split' | 'shortcuts' | 'about' | 'checkpoints'
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
  editor: Editor | null
  toast: string | null
  warnings: string[]
  docMeta: Meta
  dialog: Dialog
  setTheme: (t: Theme) => void
  setView: (v: View) => void
  setAssistantWidth: (w: number) => void
  setAssistantCollapsed: (c: boolean) => void
  setSaveState: (s: SaveState) => void
  setFileName: (n: string) => void
  setDirty: (d: boolean) => void
  setEditor: (e: Editor | null) => void
  showToast: (msg: string) => void
  setWarnings: (w: string[]) => void
  setDocMeta: (m: Meta) => void
  setDialog: (d: Dialog) => void
}

const MIN_ASSISTANT_WIDTH = 280
const TOAST_DURATION = 2500

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<AppState>((set) => ({
  theme: loadJson<Theme>('theme', 'light'),
  view: 'edit',
  assistantWidth: loadJson<number>('assistantWidth', 380),
  assistantCollapsed: loadJson<boolean>('assistantCollapsed', false),
  saveState: { kind: 'idle' },
  fileName: 'lesson.md',
  dirty: false,
  editor: null,
  toast: null,
  warnings: [],
  docMeta: EMPTY_META,
  dialog: null,

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
  setEditor: (e) => set({ editor: e }),
  showToast: (msg) => {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toast: msg })
    toastTimer = setTimeout(() => {
      set({ toast: null })
      toastTimer = null
    }, TOAST_DURATION)
  },
  setWarnings: (w) => set({ warnings: w }),
  setDocMeta: (m) => set({ docMeta: m }),
  setDialog: (d) => set({ dialog: d }),
}))

export function initTheme(): void {
  const t = loadJson<Theme>('theme', 'light')
  document.documentElement.dataset.theme = t
}
