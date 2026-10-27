import { useApp } from '../state/store'

// Part 8 will use this hook so that reverting first cancels a running draft.
// A non-null canceller that returns true means "a draft was cancelled; do not
// also undo a committed command."
let draftCanceller: (() => boolean) | null = null

export function setDraftCanceller(fn: (() => boolean) | null): void {
  draftCanceller = fn
}

export function revert(): void {
  if (draftCanceller?.()) return
  const ed = useApp.getState().editor
  if (!ed) return
  ed.commands.undo()
}

export function redo(): void {
  const ed = useApp.getState().editor
  if (!ed) return
  ed.commands.redo()
}

export function canUndo(): boolean {
  const ed = useApp.getState().editor
  return ed ? ed.can().undo() : false
}

export function canRedo(): boolean {
  const ed = useApp.getState().editor
  return ed ? ed.can().redo() : false
}
