import { Mark } from '@tiptap/core'
import FONTS_DATA from './fonts.json'

export const FONTS: { name: string; kind: string; stack: string }[] = FONTS_DATA

export function canonicalFont(name: string): string {
  const lower = name.toLowerCase()
  const found = FONTS.find(f => f.name.toLowerCase() === lower)
  return found ? found.name : name
}

export function validFontName(name: string): boolean {
  return /^[\p{L}\p{N} -]{1,40}$/u.test(name)
}

export function validSize(n: number): boolean {
  return Number.isFinite(n) && n >= 6 && n <= 72 && n % 0.5 === 0
}

export const FontStyle = Mark.create({
  name: 'fontStyle',
  excludes: 'fontStyle',

  addAttributes() {
    return {
      font: { default: null },
      size: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-font], span[data-size]',
        getAttrs: (node: HTMLElement | string) => {
          if (typeof node === 'string') return false

          const font = node.getAttribute('data-font')
          const size = node.getAttribute('data-size')

          if (font !== null && !validFontName(font)) return false
          if (size !== null && !validSize(Number(size))) return false

          return {
            font: font ?? null,
            size: size !== null ? Number(size) : null,
          }
        },
      },
    ]
  },

  renderHTML({ mark }) {
    const el = document.createElement('span')
    const font = mark.attrs.font as string | null
    const size = mark.attrs.size as number | null

    if (font !== null) el.dataset.font = font
    if (size !== null) el.dataset.size = String(size)

    if (font !== null && validFontName(font)) {
      const canonical = canonicalFont(font)
      const entry = FONTS.find(f => f.name === canonical)
      el.style.fontFamily = entry ? entry.stack : `"${font}", sans-serif`
    }

    if (size !== null) {
      el.style.fontSize = `${size}pt`
    }

    return { dom: el }
  },
})
