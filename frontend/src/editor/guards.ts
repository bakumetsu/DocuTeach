import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const splitGuardKey = new PluginKey('splitGuard')

export interface SplitGuardOptions {
  onBlocked?: () => void
}

export const SplitGuard = Extension.create<SplitGuardOptions>({
  name: 'splitGuard',

  addOptions() {
    return {
      onBlocked: () => {},
    }
  },

  addProseMirrorPlugins() {
    const onBlocked = this.options.onBlocked ?? (() => {})

    return [
      new Plugin({
        key: splitGuardKey,
        appendTransaction(transactions, _oldState, newState) {
          if (transactions.every(tr => !tr.docChanged)) {
            return null
          }

          const positions: number[] = []
          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'splitPoint') {
              positions.push(pos)
            }
            return true
          })

          if (positions.length <= 1) {
            return null
          }

          let tr = newState.tr
          for (let i = positions.length - 1; i >= 1; i--) {
            const pos = positions[i]
            const node = newState.doc.nodeAt(pos)
            if (node) {
              tr = tr.delete(pos, pos + node.nodeSize)
            }
          }

          onBlocked()

          return tr
        },
      }),
    ]
  },
})
