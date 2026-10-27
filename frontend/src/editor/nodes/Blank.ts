import { Node, mergeAttributes, type NodeConfig } from '@tiptap/core'

export const Blank = Node.create<NodeConfig & { answers: string[] }>({
  name: 'blank',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      answers: {
        default: [] as string[],
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="blank"]',
        getAttrs: (node) => {
          const el = node as HTMLElement
          try {
            const raw = el.dataset.answers
            const parsed = raw ? JSON.parse(raw) : []
            return { answers: Array.isArray(parsed) ? parsed : [] }
          } catch {
            return { answers: [] }
          }
        },
      },
    ]
  },

  renderHTML({ node }) {
    const answers = node.attrs.answers
    return [
      'span',
      mergeAttributes({
        'data-type': 'blank',
        'data-answers': JSON.stringify(answers),
      }),
      answers[0] ?? '',
    ]
  },
})
