import { BubbleMenu } from '@tiptap/react/menus'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import {
  SquareDashedBottom,
  MessageCircleQuestion,
  ListChecks,
  TriangleAlert,
  MoreHorizontal,
  CornerUpLeft,
  Pencil,
  Lock,
  LockOpen,
  Send,
} from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../state/store'
import { insertBlank } from './commands'
import { startPageStream } from './stream'
import { replyWithSelection } from '../assistant/reply'
import { startPageEdit } from './suggest/edit'
import { useEditEntry } from '../assistant/editEntry'

const SKILLS = [
  { skill: '/ccq', label: 'Generate CCQ', Icon: MessageCircleQuestion },
  { skill: '/drills', label: 'Generate 5 Drills', Icon: ListChecks },
  { skill: '/pitfalls', label: 'Generate Pitfalls', Icon: TriangleAlert },
]

const MAX_VISIBLE = 4

export function SelectionPopover({ editor }: { editor: Editor }) {
  const [showMore, setShowMore] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [lock, setLock] = useState(false)

  const runEdit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const ok = startPageEdit(editor, { instruction: trimmed, scope: 'selection', allowProtected: useEditEntry.getState().allowProtected })
    if (ok) {
      setInstruction('')
      if (!lock) setEditOpen(false)
    }
  }

  const getSelectedText = (): string => {
    const { from, to } = editor.state.selection
    return editor.state.doc.textBetween(from, to, ' ')
  }

  const visibleSkills = SKILLS.slice(0, MAX_VISIBLE)
  const hiddenSkills = SKILLS.slice(MAX_VISIBLE)

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
          <SquareDashedBottom size={16} />
        </button>
        {visibleSkills.map(({ skill, label, Icon }) => (
          <button
            key={skill}
            type="button"
            aria-label={label}
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => startPageStream(editor, { skill, selection: getSelectedText() })}
          >
            <Icon size={16} />
          </button>
        ))}
        <button
          type="button"
          aria-label="Reply"
          title="Reply"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => replyWithSelection(getSelectedText())}
        >
          <CornerUpLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Edit selection"
          title="Edit selection"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditOpen((v) => !v)}
        >
          <Pencil size={16} />
        </button>
        {editOpen && (
          <div className="popover-edit">
            <input
              type="text"
              aria-label="Edit instruction"
              placeholder="Describe the change"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  runEdit(instruction)
                }
              }}
            />
            <button
              type="button"
              className="popover-preset"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runEdit('Fix grammar and spelling mistakes')}
            >
              Fix mistakes
            </button>
            <button
              type="button"
              className="popover-preset"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runEdit('Simplify the language')}
            >
              Simplify
            </button>
            <button
              type="button"
              className="popover-preset"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runEdit('Make it shorter')}
            >
              Shorten
            </button>
            <button
              type="button"
              aria-label="Lock edit panel"
              aria-pressed={lock}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setLock((v) => !v)}
            >
              {lock ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <button
              type="button"
              aria-label="Send edit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runEdit(instruction)}
            >
              <Send size={14} />
            </button>
          </div>
        )}
        {hiddenSkills.length > 0 && (
          <div className="popover-more-wrap">
            <button
              type="button"
              aria-label="More skills"
              title="More skills"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowMore((v) => !v)}
            >
              <MoreHorizontal size={16} />
            </button>
            {showMore && (
              <div className="popover-more-list">
                {hiddenSkills.map(({ skill, label, Icon }) => (
                  <button
                    key={skill}
                    type="button"
                    className="popover-more-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setShowMore(false)
                      startPageStream(editor, { skill, selection: getSelectedText() })
                    }}
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </BubbleMenu>
  )
}
