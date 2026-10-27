import { useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Scissors } from 'lucide-react'
import { useViewMode } from '../ViewContext'

export function SplitView({ node, updateAttributes }: NodeViewProps) {
  const view = useViewMode()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')

  const initialLabel = typeof node.attrs.label === 'string' ? node.attrs.label : ''

  if (view === 'student') {
    return (
      <NodeViewWrapper className="split" contentEditable={false}>
        <hr className="split-thin" title="File split here (not printed)" />
      </NodeViewWrapper>
    )
  }

  const startEditing = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation()
    setLabel(initialLabel)
    setEditing(true)
  }

  const commit = () => {
    updateAttributes({ label: label.trim() })
    setEditing(false)
  }

  const cancel = () => {
    setEditing(false)
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  return (
    <NodeViewWrapper className="split" contentEditable={false}>
      {editing ? (
        <input
          ref={inputRef}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={onInputKeyDown}
          onBlur={commit}
        />
      ) : (
        <span className="split-label" onDoubleClick={startEditing}>
          <Scissors size={14} />
          <span>{initialLabel}</span>
        </span>
      )}
    </NodeViewWrapper>
  )
}
