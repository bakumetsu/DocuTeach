import { Node, mergeAttributes, type NodeConfig } from '@tiptap/core'

export const RawBlock = Node.create<NodeConfig & { text: string }>({
  name: 'rawBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      text: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'pre[data-type="raw-block"]',
        getAttrs: (node) => {
          const el = node as HTMLElement
          return { text: el.textContent ?? '' }
        },
      },
    ]
  },

  renderHTML({ node }) {
    return [
      'pre',
      mergeAttributes({ 'data-type': 'raw-block' }),
      node.attrs.text,
    ]
  },
})
