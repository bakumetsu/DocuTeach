import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import { loadJson, saveJson } from './persist'
import type { Meta } from '../markdown/frontmatter'
import { EMPTY_META } from '../markdown/frontmatter'

type Theme = 'light' | 'dark'
export const DAY_PALETTES = ['violet', 'sky', 'sage', 'sand', 'rose'] as const
export const NIGHT_PALETTES = ['dusk', 'sea', 'forest', 'ember', 'plum'] as const
export type DayPalette = (typeof DAY_PALETTES)[number]
export type NightPalette = (typeof NIGHT_PALETTES)[number]
export type PaletteId = DayPalette | NightPalette
type Background = 'gradient' | 'flat'
type View = 'edit' | 'student' | 'teacher'
type Dialog = null | 'colorTheme' | 'pageStyle' | 'split' | 'shortcuts' | 'about' | 'checkpoints' | 'lessons' | 'skills' | 'models'
type SaveState =
  | { kind: 'saved'; at: string }
  | { kind: 'saving' }
  | { kind: 'error'; reason: string }
  | { kind: 'idle' }

interface AppState {
  theme: Theme
  dayPalette: DayPalette
  nightPalette: NightPalette
  background: Background
  spellcheck: boolean
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
  lessonId: string
  lessonTitle: string
  dialog: Dialog
  setTheme: (t: Theme) => void
  setPalette: (id: PaletteId) => void
  setBackground: (b: Background) => void
  setSpellcheck: (on: boolean) => void
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
  setLessonId: (id: string) => void
  setLessonTitle: (t: string) => void
  setDialog: (d: Dialog) => void
}

const MIN_ASSISTANT_WIDTH = 280
const TOAST_DURATION = 2500

let toastTimer: ReturnType<typeof setTimeout> | null = null

function loadPalette<T extends PaletteId>(key: string, ids: readonly T[]): T {
  const v = loadJson<string>(key, ids[0])
  return ids.find((id) => id === v) ?? ids[0]
}

function applyTheme(theme: Theme, day: DayPalette, night: NightPalette): void {
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.palette = theme === 'dark' ? night : day
}

export const useApp = create<AppState>((set, get) => ({
  theme: loadJson<Theme>('theme', 'light'),
  dayPalette: loadPalette('dayPalette', DAY_PALETTES),
  nightPalette: loadPalette('nightPalette', NIGHT_PALETTES),
  background: loadJson<Background>('background', 'gradient'),
  spellcheck: loadJson<boolean>('spellcheck', true),
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
  lessonId: 'draft',
  lessonTitle: '',
  dialog: null,

  setTheme: (t) => {
    applyTheme(t, get().dayPalette, get().nightPalette)
    saveJson('theme', t)
    set({ theme: t })
  },
  setPalette: (id) => {
    const night = (NIGHT_PALETTES as readonly string[]).includes(id)
    const theme: Theme = night ? 'dark' : 'light'
    const day = night ? get().dayPalette : (id as DayPalette)
    const nightId = night ? (id as NightPalette) : get().nightPalette
    applyTheme(theme, day, nightId)
    saveJson(night ? 'nightPalette' : 'dayPalette', id)
    saveJson('theme', theme)
    set({ theme, dayPalette: day, nightPalette: nightId })
  },
  setBackground: (b) => {
    document.documentElement.dataset.bg = b
    saveJson('background', b)
    set({ background: b })
  },
  setSpellcheck: (on) => {
    saveJson('spellcheck', on)
    set({ spellcheck: on })
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
  setLessonId: (id) => set({ lessonId: id }),
  setLessonTitle: (t) => set({ lessonTitle: t }),
  setDialog: (d) => set({ dialog: d }),
}))

export function initTheme(): void {
  const t = loadJson<Theme>('theme', 'light')
  applyTheme(t, loadPalette('dayPalette', DAY_PALETTES), loadPalette('nightPalette', NIGHT_PALETTES))
  const bg = loadJson<Background>('background', 'gradient')
  document.documentElement.dataset.bg = bg
}
