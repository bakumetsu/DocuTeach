// frontend/src/editor/pageBreaksPlugin.ts

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { computeBreaks, type BreakItem } from './pageBreaks'

export const pageBreaksKey = new PluginKey('pageBreaks')

interface StoredBreak {
  pos: number
  remaining: number
  row: boolean
}

interface PluginState {
  breaks: StoredBreak[]
  deco: DecorationSet
}

function blockDom(remaining: number) {
  const div = document.createElement('div')
  div.className = 'page-break-spacer'
  div.setAttribute('contenteditable', 'false')
  div.setAttribute('aria-hidden', 'true')
  div.style.setProperty('--pb-rem', `${remaining}px`)
  return div
}

function rowDom(remaining: number) {
  const tr = document.createElement('tr')
  tr.className = 'page-break-spacer-row'
  tr.setAttribute('contenteditable', 'false')
  tr.setAttribute('aria-hidden', 'true')
  const td = document.createElement('td')
  td.setAttribute('colspan', '99')
  td.appendChild(blockDom(remaining))
  tr.appendChild(td)
  return tr
}

function makeDeco(b: StoredBreak): Decoration {
  const opts = { side: -1, key: `pb-${b.pos}-${Math.round(b.remaining)}`, ignoreSelection: true }
  if (b.row) {
    return Decoration.widget(b.pos, () => rowDom(b.remaining), opts)
  }
  return Decoration.widget(b.pos, () => blockDom(b.remaining), opts)
}

function breaksEqual(a: StoredBreak[], b: StoredBreak[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].remaining !== b[i].remaining || a[i].row !== b[i].row) return false
  }
  return true
}

export const PageBreaks = Extension.create({
  name: 'PageBreaks',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: pageBreaksKey,

        state: {
          init: (_, state) => ({
            breaks: [],
            deco: DecorationSet.create(state.doc, []),
          }),
          apply(tr, value) {
            const meta = tr.getMeta(pageBreaksKey) as StoredBreak[] | undefined
            if (meta) {
              return { breaks: meta, deco: DecorationSet.create(tr.doc, meta.map(makeDeco)) }
            }
            if (tr.docChanged) {
              const breaks = value.breaks.map((b) => ({ ...b, pos: tr.mapping.map(b.pos) }))
              return { breaks, deco: value.deco.map(tr.mapping, tr.doc) }
            }
            return value
          },
        },

        props: {
          decorations: (state) => {
            const s = pageBreaksKey.getState(state)
            return s ? s.deco : DecorationSet.create(state.doc, [])
          },
        },

        view(view) {
          let rafId: number | undefined
          let ro: ResizeObserver | undefined

          const scheduleMeasure = () => {
            if (typeof requestAnimationFrame === 'undefined') return
            if (rafId !== undefined) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
              rafId = undefined
              measure()
            })
          }

          const measure = () => {
            try {
              const page = view.dom.closest('.page') as HTMLElement | null
              if (!page || view.dom.offsetParent === null) return

              const cs = getComputedStyle(page)
              const pageH = (297 * 96) / 25.4 - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
              if (pageH < 100) return

              const rootTop = view.dom.getBoundingClientRect().top
              const spacers: { top: number; height: number }[] = []
              view.dom.querySelectorAll('.page-break-spacer').forEach((el) => {
                const r = el.getBoundingClientRect()
                spacers.push({ top: r.top, height: r.height })
              })

              const natural = (y: number) => {
                let sum = 0
                for (const s of spacers) {
                  if (s.top < y - 0.5) sum += s.height
                }
                return y - rootTop - sum
              }

              const items: BreakItem[] = []
              const offsets: number[] = []
              const rowOffsetsMap = new Map<number, number[]>()
              let prevBottom: number | undefined

              view.state.doc.forEach((node, offset) => {
                const dom = view.nodeDOM(offset) as HTMLElement | null
                if (!dom || getComputedStyle(dom).display === 'none') return

                const i = items.length
                const ncs = getComputedStyle(dom)
                const rect = dom.getBoundingClientRect()
                const top = i === 0 ? natural(rect.top) - parseFloat(ncs.marginTop) : (prevBottom ?? 0)
                const bottom = natural(rect.bottom) + parseFloat(ncs.marginBottom)

                const item: BreakItem = { top, bottom }
                if (node.type.name === 'heading') item.keepWithNext = true

                if (node.type.name === 'table') {
                  const rows: { top: number; bottom: number }[] = []
                  const rowPos: number[] = []
                  let rPrev: number | undefined

                  node.forEach((_row, rowOffset) => {
                    const rEl = view.nodeDOM(offset + 1 + rowOffset) as HTMLElement | null
                    if (!rEl) return
                    const rRect = rEl.getBoundingClientRect()
                    const rTop = rPrev === undefined ? top : rPrev
                    const rBottom = natural(rRect.bottom)
                    rowPos.push(offset + 1 + rowOffset)
                    rows.push({ top: rTop, bottom: rBottom })
                    rPrev = rBottom
                  })

                  if (rows.length > 0) {
                    rows[rows.length - 1].bottom = bottom
                    rowOffsetsMap.set(i, rowPos)
                    item.rows = rows
                  }
                }

                items.push(item)
                offsets.push(offset)
                prevBottom = bottom
              })

              const breaks = computeBreaks(items, pageH)
              const stored: StoredBreak[] = breaks.map((pb) => {
                const remaining = Math.round(pb.remaining)
                if (pb.row !== undefined) {
                  const rp = rowOffsetsMap.get(pb.index)
                  return { pos: rp ? rp[pb.row] : offsets[pb.index], remaining, row: true }
                }
                return { pos: offsets[pb.index], remaining, row: false }
              })

              const current = pageBreaksKey.getState(view.state)
              if (!current || !breaksEqual(current.breaks, stored)) {
                view.dispatch(
                  view.state.tr
                    .setMeta(pageBreaksKey, stored)
                    .setMeta('addToHistory', false)
                )
              }

              page.style.setProperty('--page-count', String(breaks.length + 1))
            } catch {
              // ignore measurement errors
            }
          }

          scheduleMeasure()

          if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(scheduleMeasure)
            ro.observe(view.dom)
          }

          return {
            update: () => {
              scheduleMeasure()
            },
            destroy: () => {
              if (ro) ro.disconnect()
              if (rafId !== undefined) cancelAnimationFrame(rafId)
            },
          }
        },
      }),
    ]
  },
})
