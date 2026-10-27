import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Highlight } from '@tiptap/extension-highlight'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { ListItem } from '@tiptap/extension-list'

import { DocMeta } from './nodes/DocMeta'
import { TeacherNote } from './nodes/TeacherNote'
import { Blank } from './nodes/Blank'
import { Mcq, McqQuestion, McqOption } from './nodes/Mcq'
import { SplitPoint } from './nodes/SplitPoint'
import { RawBlock } from './nodes/RawBlock'
import { Align } from './nodes/Align'

export const extensions = [
  DocMeta,
  StarterKit.configure({
    document: false,
    link: false,
    blockquote: false,
    codeBlock: false,
    code: false,
    strike: false,
    horizontalRule: false,
    listKeymap: false,
    trailingNode: false,
    listItem: false,
    heading: {
      levels: [1, 2, 3, 4, 5, 6],
    },
    undoRedo: {
      newGroupDelay: 500,
    },
  }),
  ListItem.extend({
    content: 'paragraph (bulletList | orderedList)?',
  }),
  Highlight.configure({ multicolor: false }),
  Table,
  TableRow,
  TableHeader.extend({
    content: 'paragraph',
  }),
  TableCell.extend({
    content: 'paragraph',
  }),
  TeacherNote,
  Blank,
  Mcq,
  McqQuestion,
  McqOption,
  SplitPoint,
  RawBlock,
  Align,
]

export const schema = getSchema(extensions)
