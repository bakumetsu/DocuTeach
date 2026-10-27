import { Node, mergeAttributes, type NodeConfig } from '@tiptap/core'

export const SplitPoint = Node.create<NodeConfig & { label: string }>({
  name: 'splitPoint',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      label: {
        default: 'Homework starts here',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="split-point"]',
        getAttrs: (node) => {
          const el = node as HTMLElement
          return { label: el.dataset.label ?? 'Homework starts here' }
        },
      },
    ]
  },

  renderHTML({ node }) {
    return [
      'div',
      mergeAttributes({
        'data-type': 'split-point',
        'data-label': node.attrs.label,
      }),
    ]
  },
})
