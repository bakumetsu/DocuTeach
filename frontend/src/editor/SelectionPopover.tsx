import { BubbleMenu } from '@tiptap/react/menus'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { SquareDashedBottom } from 'lucide-react'
import { useApp } from '../state/store'
import { insertBlank } from './commands'
import { startPageStream } from './stream'

export function SelectionPopover({ editor }: { editor: Editor }) {
  const getSelectedText = (): string => {
    const { from, to } = editor.state.selection
    return editor.state.doc.textBetween(from, to, ' ')
  }

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ state }) => {
        const selection = state.selection
        if (useApp.getState().view !== 'edit') return false
        if (selection.empty) return false
        if (!(selection instanceof TextSelection)) return false
        return selection.$from.parent.isTextblock
      }}
      options={{ placement: 'top' }}
    >
      <div className="selection-popover">
        <button
          type="button"
          aria-label="Insert blank"
          title="Insert blank"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertBlank(editor)}
        >
          <SquareDashedBottom size={14} />
        </button>
        <button
          type="button"
          aria-label="Generate CCQ"
          title="Generate CCQ"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startPageStream(editor, { skill: '/ccq', selection: getSelectedText() })}
        >
          + CCQ
        </button>
        <button
          type="button"
          aria-label="Generate 5 Drills"
          title="Generate 5 Drills"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startPageStream(editor, { skill: '/drills', selection: getSelectedText() })}
        >
          + 5 Drills
        </button>
        <button
          type="button"
          aria-label="Generate Pitfalls"
          title="Generate Pitfalls"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startPageStream(editor, { skill: '/pitfalls', selection: getSelectedText() })}
        >
          + Pitfalls
        </button>
      </div>
    </BubbleMenu>
  )
}
