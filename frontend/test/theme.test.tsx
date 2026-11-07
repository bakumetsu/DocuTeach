import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { useApp, initTheme } from '../src/state/store'
import { ThemeDialog, SWATCHES } from '../src/ui/dialogs/ThemeDialog'

const root = document.documentElement
const KEY = 'docuteach:v1:'

function reset() {
  localStorage.clear()
  useApp.setState({ theme: 'light', dayPalette: 'violet', nightPalette: 'dusk' })
  delete root.dataset.theme
  delete root.dataset.palette
}

beforeEach(reset)
afterEach(cleanup)

describe('palette state', () => {
  it('defaults to violet / light after initTheme()', () => {
    initTheme()
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.palette).toBe('violet')
  })

  it('setPalette("sea") switches to dark, applies and saves both keys', () => {
    useApp.getState().setPalette('sea')
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.palette).toBe('sea')
    expect(localStorage.getItem(KEY + 'nightPalette')).toBe('"sea"')
    expect(localStorage.getItem(KEY + 'theme')).toBe('"dark"')
  })

  it('toggling back to light restores the saved day palette', () => {
    useApp.getState().setPalette('sage')
    useApp.getState().setPalette('plum')
    useApp.getState().setTheme('light')
    expect(root.dataset.palette).toBe('sage')
    useApp.getState().setTheme('dark')
    expect(root.dataset.palette).toBe('plum')
  })

  it('initTheme() restores the saved pair; a stale id falls back to the default', () => {
    useApp.getState().setPalette('ember')
    initTheme()
    expect(root.dataset.palette).toBe('ember')
    localStorage.setItem(KEY + 'nightPalette', '"nope"')
    initTheme()
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.palette).toBe('dusk')
  })
})

describe('ThemeDialog', () => {
  it('shows 5 + 5 swatches, selection applies, arrows move', () => {
    render(<ThemeDialog open onClose={() => {}} />)
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2)
    expect(screen.getAllByRole('radio')).toHaveLength(10)
    fireEvent.click(screen.getByRole('radio', { name: 'Rose' }))
    expect(root.dataset.palette).toBe('rose')
    const rose = screen.getByRole('radio', { name: 'Rose' })
    expect(rose.getAttribute('aria-checked')).toBe('true')
    expect(rose.tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'Sky' }).tabIndex).toBe(-1)
    fireEvent.keyDown(rose, { key: 'ArrowRight' })
    expect(root.dataset.palette).toBe('violet')
  })

  it('swatch table matches tokens.css', () => {
    const css = readFileSync('src/styles/tokens.css', 'utf-8')
    for (const [id, s] of Object.entries(SWATCHES)) {
      const night = ['dusk', 'sea', 'forest', 'ember', 'plum'].includes(id)
      const sel = id === 'violet' ? ':root {' : id === 'dusk' ? ':root[data-theme="dark"] {'
        : night ? `:root[data-theme="dark"][data-palette="${id}"] {`
        : `:root[data-palette="${id}"]:not([data-theme="dark"]) {`
      const at = css.indexOf(sel)
      expect(at, id).toBeGreaterThanOrEqual(0)
      const block = css.slice(at, css.indexOf('}', at))
      expect(block, id).toContain(`--bg: ${s.bg};`)
      expect(block, id).toContain(`--acc: ${s.acc};`)
    }
  })
})

describe('exports ignore the screen theme', () => {
  it.each(['src/files/exportActions.ts', 'src/api/mock/exports.ts'])('%s has no token or computed-style access', (f) => {
    const src = readFileSync(f, 'utf-8')
    expect(src).not.toContain('var(--')
    expect(src).not.toContain('getComputedStyle')
  })
})
