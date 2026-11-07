import { describe, it, expect, beforeEach } from 'vitest'
import { useApp, initTheme } from '../src/state/store'

describe('background', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.bg
  })

  it('defaults to gradient after initTheme()', () => {
    initTheme()
    expect(document.documentElement.dataset.bg).toBe('gradient')
  })

  it('setBackground("flat") updates dataset, store, and localStorage', () => {
    useApp.getState().setBackground('flat')
    expect(document.documentElement.dataset.bg).toBe('flat')
    expect(useApp.getState().background).toBe('flat')
    expect(localStorage.getItem('docuteach:v1:background')).toBe('"flat"')
  })

  it('persists background across initTheme() calls', () => {
    useApp.getState().setBackground('flat')
    initTheme()
    expect(document.documentElement.dataset.bg).toBe('flat')
    useApp.getState().setBackground('gradient')
    expect(document.documentElement.dataset.bg).toBe('gradient')
  })
})
