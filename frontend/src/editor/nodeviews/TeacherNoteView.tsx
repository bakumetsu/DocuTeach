import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Popover } from '../../ui/Popover'
import { useViewMode } from '../ViewContext'
import { setNoteTag } from '../commands'

const TAG_PRESETS = ['CCQ', 'Pitfalls', 'Distractors', 'Drills'] as const

export function TeacherNoteView({ node, editor, getPos }: NodeViewProps) {
  const view = useViewMode()
  const chipRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [value, setValue] = useState('')

  const tag = typeof node.attrs.tag === 'string' ? node.attrs.tag : ''

  const openPopover = useCallback(() => {
    const pos = getPos()
    if (pos == null) return
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null
    setAnchor(dom)
    setValue(tag)
    setOpen(true)
  }, [editor, getPos, tag])

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [open])

  const confirm = () => {
    const pos = getPos()
    if (pos == null) return
    setNoteTag(editor, pos, value.trim())
    setOpen(false)
  }

  const cancel = () => {
    setOpen(false)
  }

  const onChipClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (view !== 'edit') return
    event.stopPropagation()
    openPopover()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      confirm()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  if (view === 'student') {
    return <NodeViewWrapper className="note" hidden />
  }

  const chipLabel =
    view === 'edit'
      ? tag || 'note'
      : tag
        ? `teacher note · ${tag}`
        : 'teacher note'

  return (
    <NodeViewWrapper className="note">
      <button
        ref={chipRef}
        type="button"
        contentEditable={false}
        className="note-chip"
        onClick={onChipClick}
      >
        {chipLabel}
      </button>

      {open && view === 'edit' && (
        <Popover anchor={anchor} open onClose={cancel}>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
          <div className="note-tag-presets">
            {TAG_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                contentEditable={false}
                onClick={(event) => {
                  event.stopPropagation()
                  setValue(preset)
                  inputRef.current?.focus()
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </Popover>
      )}

      <NodeViewContent className="note-content" />
    </NodeViewWrapper>
  )
}
