import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useViewMode } from '../ViewContext'
import { toggleCorrect } from '../commands'

export function McqView({ node }: NodeViewProps) {
  const view = useViewMode()
  const multi = node.attrs.multi === true

  let correctCount = 0
  node.forEach((child) => {
    if (child.type.name === 'mcqOption' && child.attrs.correct === true) {
      correctCount += 1
    }
  })

  const showWarning = view !== 'student' && correctCount === 0

  return (
    <NodeViewWrapper className="mcq" data-multi={String(multi)}>
      {showWarning && <span className="mcq-warn" contentEditable={false}>No correct answer</span>}
      <NodeViewContent />
    </NodeViewWrapper>
  )
}

export function McqOptionView({ node, editor, getPos }: NodeViewProps) {
  const view = useViewMode()
  const correct = node.attrs.correct === true

  const onClick = () => {
    if (view === 'student') return
    const pos = getPos()
    if (pos == null) return
    toggleCorrect(editor, pos)
  }

  return (
    <NodeViewWrapper className="mcq-option" data-correct={String(correct)}>
      <button
        type="button"
        contentEditable={false}
        className="mcq-letter"
        aria-pressed={correct}
        aria-label="Mark option correct"
        disabled={view === 'student'}
        onClick={onClick}
      />
      <NodeViewContent className="mcq-option-text" />
    </NodeViewWrapper>
  )
}
