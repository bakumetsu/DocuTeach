import { Extension } from '@tiptap/core'

const VALID_ALIGN = ['left', 'center', 'right', 'justify'] as const

export const Align = Extension.create({
  name: 'align',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          align: {
            default: 'left',
            parseHTML: (element: HTMLElement) => {
              const val = element.style.textAlign
              return VALID_ALIGN.includes(val as typeof VALID_ALIGN[number]) ? val : 'left'
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              if (!attributes.align || attributes.align === 'left') return {}
              return { style: `text-align:${attributes.align}` }
            },
          },
        },
      },
    ]
  },
})
