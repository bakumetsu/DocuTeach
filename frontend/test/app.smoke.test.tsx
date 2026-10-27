import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import App from '../src/App'

const lessonText = readFileSync('public/sample/lesson.md', 'utf-8')

describe('App smoke', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/sample/lesson.md') {
          return { ok: true, text: async () => lessonText }
        }
        return { ok: false, text: async () => '' }
      }),
    )
    localStorage.clear()
  })

  afterEach(cleanup)

  it('renders the sample lesson with expected structure', async () => {
    render(<App />)

    await screen.findByText('Present Perfect: Unfinished Time', {}, { timeout: 5000 })

    // (a) .page-content exists
    expect(document.querySelector('.page-content')).not.toBeNull()

    // (b) at least one .note and one .mcq
    expect(document.querySelectorAll('.note').length).toBeGreaterThanOrEqual(1)
    expect(document.querySelectorAll('.mcq').length).toBeGreaterThanOrEqual(1)

    // (c) Vietnamese heading text present in document
    expect(document.body.textContent).toContain('Thì hiện tại hoàn thành: Đã và đang')

    // (d) no absolute http references in the rendered DOM
    expect(
      document.querySelectorAll(
        'a[href^="http"], img[src^="http"], link[href^="http"], script[src^="http"]',
      ).length,
    ).toBe(0)
  })
})
