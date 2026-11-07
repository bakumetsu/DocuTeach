// frontend/src/editor/numberingPlugin.ts

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { type Node } from '@tiptap/pm/model'
import { numberQuestions } from './numbering'

export const numberingKey = new PluginKey('questionNumbering')

function questionDom(label: string) {
  const span = document.createElement('span')
  span.className = 'q-num'
  span.setAttribute('contenteditable', 'false')
  span.setAttribute('aria-hidden', 'true')
  span.textContent = `${label}.`
  return span
}

function buildDecos(doc: Node): DecorationSet {
  const questions = numberQuestions(doc)
  const decos: Decoration[] = []
  const seenListPos = new Set<number>()

  for (const q of questions) {
    if (q.textPos !== -1) {
      decos.push(
        Decoration.widget(
          q.textPos,
          () => questionDom(q.label),
          { side: -1, key: `qn-${q.label}-${q.textPos}`, ignoreSelection: true },
        ),
      )
    }

    if (q.kind === 'item' && q.listPos != null && !seenListPos.has(q.listPos)) {
      seenListPos.add(q.listPos)
      const node = doc.nodeAt(q.listPos)
      if (node) decos.push(Decoration.node(q.listPos, q.listPos + node.nodeSize, { class: 'q-list' }))
    }
  }

  return DecorationSet.create(doc, decos)
}

export const QuestionNumbering = Extension.create({
  name: 'QuestionNumbering',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: numberingKey,
        state: {
          init: (_, state) => buildDecos(state.doc),
          apply: (tr, old) => (tr.docChanged ? buildDecos(tr.doc) : old),
        },
        props: {
          decorations: (state) => numberingKey.getState(state),
        },
      }),
    ]
  },
})
