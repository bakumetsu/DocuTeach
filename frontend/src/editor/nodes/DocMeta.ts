import { Node, type NodeConfig } from '@tiptap/core'

export const DocMeta = Node.create<NodeConfig & { meta: { raw: string; data: unknown } }>({
  name: 'doc',
  topNode: true,
  content: 'block+',

  addAttributes() {
    return {
      meta: {
        default: { raw: '', data: null },
      },
    }
  },
})
