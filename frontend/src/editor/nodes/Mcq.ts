import { Node, mergeAttributes, type NodeConfig } from '@tiptap/core'

export const Mcq = Node.create<NodeConfig & { multi: boolean }>({
  name: 'mcq',
  group: 'block',
  content: 'mcqQuestion mcqOption{2,}',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      multi: {
        default: false,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mcq"]',
        getAttrs: (node) => {
          const el = node as HTMLElement
          return { multi: el.dataset.multi === 'true' }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mcq',
        'data-multi': String(node.attrs.multi),
      }),
      0,
    ]
  },
})

export const McqQuestion = Node.create({
  name: 'mcqQuestion',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p[data-type="mcq-question"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'mcq-question' }), 0]
  },
})

export const McqOption = Node.create<NodeConfig & { correct: boolean }>({
  name: 'mcqOption',
  content: 'inline*',

  addAttributes() {
    return {
      correct: {
        default: false,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mcq-option"]',
        getAttrs: (node) => {
          const el = node as HTMLElement
          return { correct: el.dataset.correct === 'true' }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mcq-option',
        'data-correct': String(node.attrs.correct),
      }),
      0,
    ]
  },
})
