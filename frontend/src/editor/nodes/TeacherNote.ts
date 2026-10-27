import { Node, mergeAttributes, type NodeConfig } from '@tiptap/core'

export const TeacherNote = Node.create<NodeConfig & { tag: string }>({
  name: 'teacherNote',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      tag: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="teacher-note"]',
        getAttrs: (node) => {
          const el = node as HTMLElement
          return { tag: el.dataset.tag ?? '' }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'teacher-note',
        'data-tag': node.attrs.tag,
      }),
      0,
    ]
  },
})
