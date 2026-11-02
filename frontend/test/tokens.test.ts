import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles/tokens.css', 'utf-8')
const appCss = readFileSync('src/styles/app.css', 'utf-8')
const pageCss = readFileSync('src/styles/page.css', 'utf-8')

function extractBlock(pattern: RegExp): string {
  const m = css.match(pattern)
  if (!m) throw new Error(`Block not found: ${pattern}`)
  return m[1]
}

function parseCustomProps(blockText: string): Record<string, string> {
  const props: Record<string, string> = {}
  const re = /--([\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(blockText)) !== null) {
    props[m[1]] = m[2].trim()
  }
  return props
}

const lightBlock = extractBlock(/:root\s*\{([^}]+)\}/)
const darkBlock = extractBlock(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)
const light = parseCustomProps(lightBlock)
const dark = parseCustomProps(darkBlock)

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function srgbChannel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.02 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
}

function contrast(hexA: string, hexB: string): number {
  const la = luminance(hexA)
  const lb = luminance(hexB)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('tokens.css', () => {
  describe('parity', () => {
    it('every light custom property exists in dark and vice versa', () => {
      const lightNames = Object.keys(light)
      const darkNames = Object.keys(dark)
      for (const name of lightNames) {
        expect(darkNames, `--${name} missing in dark block`).toContain(name)
      }
      for (const name of darkNames) {
        expect(lightNames, `--${name} missing in light block`).toContain(name)
      }
    })
  })

  describe('contrast', () => {
    const pairs: [string, string][] = [
      ['text', 'panel'],
      ['text', 'bg'],
      ['muted', 'panel'],
      ['muted', 'bg'],
      ['muted', 'acc-soft'],
      ['acc', 'panel'],
      ['acc', 'acc-soft'],
      ['text', 'acc-soft'],
      ['text', 'note-bg'],
      ['err', 'panel'],
      ['warn', 'warn-bg'],
      ['ok', 'panel'],
      ['badge-active-fg', 'badge-active-bg'],
      ['badge-planned-fg', 'badge-planned-bg'],
      ['acc-ink', 'acc'],
    ]

    it('light theme: all pairs meet WCAG AA (>= 4.5)', () => {
      for (const [fg, bg] of pairs) {
        const ratio = contrast(light[fg], light[bg])
        expect(ratio, `light --${fg} on --${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('dark theme: all pairs meet WCAG AA (>= 4.5)', () => {
      for (const [fg, bg] of pairs) {
        const ratio = contrast(dark[fg], dark[bg])
        expect(ratio, `dark --${fg} on --${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('focus ring contrast >= 3 against panel', () => {
      const lr = contrast(light['focus-ring'], light['panel'])
      expect(lr, `light --focus-ring on --panel = ${lr.toFixed(2)}`).toBeGreaterThanOrEqual(3)
      const dr = contrast(dark['focus-ring'], dark['panel'])
      expect(dr, `dark --focus-ring on --panel = ${dr.toFixed(2)}`).toBeGreaterThanOrEqual(3)
    })
  })

  describe('background', () => {
    it('has :root[data-bg="flat"] rule setting --ground', () => {
      expect(css).toMatch(/:root\[data-bg="flat"\]\s*\{[^}]*--ground[^}]*\}/)
    })

    it(':root defines --ground and --bg-grad', () => {
      expect(light).toHaveProperty('ground')
      expect(light).toHaveProperty('bg-grad')
    })
  })

  describe('no raw colours outside tokens.css', () => {
    const colourRe = /#[0-9a-fA-F]{3,8}\b|rgba?\(/

    it('app.css contains no raw hex or rgba() colours', () => {
      expect(appCss).not.toMatch(colourRe)
    })

    it('page.css contains no raw hex or rgba() colours', () => {
      expect(pageCss).not.toMatch(colourRe)
    })
  })
})
