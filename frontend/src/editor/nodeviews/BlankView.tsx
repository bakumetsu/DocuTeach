import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Popover } from '../../ui/Popover'
import { useViewMode } from '../ViewContext'
import { blankToText, setBlankAnswers } from '../commands'
import { X } from 'lucide-react'

type BlankForm = {
  main: string
  alternatives: string[]
}

export function BlankView({ node, editor, getPos, selected }: NodeViewProps) {
  const view = useViewMode()
  const mainInputRef = useRef<HTMLInputElement>(null)
  const alternativeInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [form, setForm] = useState<BlankForm>({ main: '', alternatives: [] })

  const rawAnswers = node.attrs.answers
  const answers: string[] = Array.isArray(rawAnswers)
    ? rawAnswers.filter((answer): answer is string => typeof answer === 'string')
    : []

  const main = answers[0] ?? ''
  const alternatives = answers.slice(1)
  const moreCount = alternatives.length

  const openPopover = useCallback(() => {
    const pos = getPos()
    if (pos == null) return
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null
    const raw = node.attrs.answers
    const ans: string[] = Array.isArray(raw)
      ? raw.filter((a): a is string => typeof a === 'string')
      : []
    setAnchor(dom)
    setForm({
      main: ans[0] ?? '',
      alternatives: ans.slice(1),
    })
    setOpen(true)
  }, [editor, getPos, node])

  useEffect(() => {
    if (!open) return
    mainInputRef.current?.focus()
    mainInputRef.current?.select()
  }, [open])

  useEffect(() => {
    if (!selected || view !== 'edit' || open) return

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Enter') return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLButtonElement
      ) {
        return
      }
      event.preventDefault()
      openPopover()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selected, view, open, openPopover])

  useEffect(() => {
    if (view !== 'edit') return

    const onOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ pos?: number }>).detail
      if (detail?.pos == null) return
      const pos = getPos()
      if (pos == null || detail.pos !== pos) return
      openPopover()
    }

    window.addEventListener('docuteach:open-blank', onOpenRequest)
    return () => window.removeEventListener('docuteach:open-blank', onOpenRequest)
  }, [getPos, view, openPopover])

  const confirm = () => {
    const pos = getPos()
    if (pos == null) return
    const next = [form.main, ...form.alternatives]
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    setBlankAnswers(editor, pos, next)
    setOpen(false)
  }

  const cancel = () => {
    setOpen(false)
  }

  const toText = () => {
    const pos = getPos()
    if (pos == null) return
    blankToText(editor, pos)
    setOpen(false)
  }

  const addAlternative = () => {
    setForm((previous) => ({
      ...previous,
      alternatives: [...previous.alternatives, ''],
    }))
  }

  const removeAlternative = (index: number) => {
    setForm((previous) => ({
      ...previous,
      alternatives: previous.alternatives.filter((_, altIndex) => altIndex !== index),
    }))
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      confirm()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      const inputs = [
        mainInputRef.current,
        ...alternativeInputRefs.current,
      ].filter((input): input is HTMLInputElement => input !== null)

      if (inputs.length === 0) return

      const currentIndex = inputs.findIndex((input) => input === event.currentTarget)
      if (currentIndex === -1) return

      const nextIndex = event.shiftKey
        ? (currentIndex - 1 + inputs.length) % inputs.length
        : (currentIndex + 1) % inputs.length

      inputs[nextIndex]?.focus()
    }
  }

  const onClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (view !== 'edit') return
    event.stopPropagation()
    openPopover()
  }

  if (view === 'student') {
    return <NodeViewWrapper as="span" className="blank-line" />
  }

  const editable = view === 'edit'

  return (
    <NodeViewWrapper as="span" className="blank" onClick={onClick}>
      {main ? (
        <>
          <span className="blank-main">{main}</span>
          {moreCount > 0 && <span className="blank-more">+{moreCount}</span>}
        </>
      ) : (
        <span className="blank-empty" title="Empty blank" />
      )}

      {view === 'teacher' && alternatives.length > 0 && (
        <span className="blank-alternatives"> / {alternatives.join(' / ')}</span>
      )}

      {open && editable && (
        <Popover anchor={anchor} open onClose={cancel}>
          <div className="blank-popover">
            <input
              ref={mainInputRef}
              value={form.main}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, main: event.target.value }))
              }
              onKeyDown={onInputKeyDown}
            />

            {form.alternatives.map((alternative, index) => (
              <div key={index} className="blank-alternative-row">
                <input
                  ref={(element) => {
                    alternativeInputRefs.current[index] = element
                  }}
                  value={alternative}
                  onChange={(event) =>
                    setForm((previous) => {
                      const nextAlternatives = previous.alternatives.slice()
                      nextAlternatives[index] = event.target.value
                      return { ...previous, alternatives: nextAlternatives }
                    })
                  }
                  onKeyDown={onInputKeyDown}
                />
                <button
                  type="button"
                  contentEditable={false}
                  onClick={(event) => {
                    event.stopPropagation()
                    removeAlternative(index)
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}

            <div className="blank-popover-actions">
              <button type="button" contentEditable={false} onClick={addAlternative}>
                + alternative
              </button>
              <button type="button" contentEditable={false} onClick={toText}>
                Turn back into text
              </button>
            </div>
          </div>
        </Popover>
      )}
    </NodeViewWrapper>
  )
}
