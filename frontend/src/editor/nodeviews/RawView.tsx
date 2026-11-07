import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useViewMode } from '../ViewContext'

export function RawView({ node }: NodeViewProps) {
  const view = useViewMode()
  const text = typeof node.attrs.text === 'string' ? node.attrs.text : ''

  if (view === 'student') {
    return <NodeViewWrapper className="raw" hidden />
  }

  return (
    <NodeViewWrapper className="raw">
      <div className="raw-header">Unsupported block (kept as written)</div>
      <pre>{text}</pre>
    </NodeViewWrapper>
  )
}
