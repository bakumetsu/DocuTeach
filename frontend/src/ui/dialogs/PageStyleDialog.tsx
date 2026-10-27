import { useState } from 'react'
import { useApp } from '../../state/store'
import { setMeta } from '../../editor/docio'
import { updateMeta } from '../../markdown/frontmatter'
import {
  DEFAULT_PAGE,
  pageStyleToMeta,
  readPageStyle,
  type PageStyle,
} from '../../editor/pageStyle'
import { Dialog } from './Dialog'

const FONTS = [
  'Arial',
  'Times New Roman',
  'Tahoma',
  'Verdana',
  'Calibri',
  'Cambria',
  'Noto Sans',
  'Noto Serif',
] as const

interface FormState {
  font: string
  size: string
  line: string
  top: string
  right: string
  bottom: string
  left: string
}

function toFormState(style: PageStyle): FormState {
  return {
    font: style.font,
    size: String(style.size),
    line: String(style.line),
    top: String(style.margins[0]),
    right: String(style.margins[1]),
    bottom: String(style.margins[2]),
    left: String(style.margins[3]),
  }
}

function defaultFormState(): FormState {
  return toFormState(DEFAULT_PAGE)
}

function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampForm(form: FormState): PageStyle {
  return {
    font: FONTS.includes(form.font as (typeof FONTS)[number])
      ? form.font
      : DEFAULT_PAGE.font,
    size: clampNumber(form.size, 8, 24, DEFAULT_PAGE.size),
    line: clampNumber(form.line, 1, 3, DEFAULT_PAGE.line),
    margins: [
      clampNumber(form.top, 0, 60, DEFAULT_PAGE.margins[0]),
      clampNumber(form.right, 0, 60, DEFAULT_PAGE.margins[1]),
      clampNumber(form.bottom, 0, 60, DEFAULT_PAGE.margins[2]),
      clampNumber(form.left, 0, 60, DEFAULT_PAGE.margins[3]),
    ],
  }
}

export function PageStyleDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { editor, docMeta } = useApp()

  const [form, setForm] = useState<FormState>(() =>
    toFormState(readPageStyle(docMeta)),
  )

  // Reset the form when the dialog opens or when the backing meta changes
  // while it is open. Done during render (not in an effect) to avoid
  // cascading renders from a synchronous setState inside an effect.
  const resetKey = open ? docMeta : null
  const [prevResetKey, setPrevResetKey] = useState<
    typeof docMeta | null
  >(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    if (open) {
      setForm(toFormState(readPageStyle(docMeta)))
    }
  }

  const broken = Boolean(docMeta?.broken)
  const preview = clampForm(form)
  const okDisabled = broken || !editor

  function updateField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleOk() {
    if (!editor || broken) return
    setMeta(editor, updateMeta(docMeta, { page: pageStyleToMeta(clampForm(form)) }))
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="Page style"
      onClose={onClose}
      onOk={handleOk}
      okDisabled={okDisabled}
    >
      {broken ? (
        <p role="alert">
          The front matter of this file is not valid YAML, so page style is
          disabled.
        </p>
      ) : null}

      <fieldset disabled={broken}>
        <div className="page-style-field">
          <label htmlFor="page-style-font">Font</label>
          <select
            id="page-style-font"
            value={form.font}
            onChange={(e) => updateField('font', e.target.value)}
          >
            {FONTS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>

        <div className="page-style-field">
          <label htmlFor="page-style-size">Size (pt)</label>
          <input
            id="page-style-size"
            type="number"
            min={8}
            max={24}
            value={form.size}
            onChange={(e) => updateField('size', e.target.value)}
          />
        </div>

        <div className="page-style-field">
          <label htmlFor="page-style-line">Line spacing</label>
          <input
            id="page-style-line"
            type="number"
            min={1}
            max={3}
            step={0.05}
            value={form.line}
            onChange={(e) => updateField('line', e.target.value)}
          />
        </div>

        <div className="page-style-field">
          <label htmlFor="page-style-top">Top margin (mm)</label>
          <input
            id="page-style-top"
            type="number"
            min={0}
            max={60}
            value={form.top}
            onChange={(e) => updateField('top', e.target.value)}
          />
        </div>

        <div className="page-style-field">
          <label htmlFor="page-style-right">Right margin (mm)</label>
          <input
            id="page-style-right"
            type="number"
            min={0}
            max={60}
            value={form.right}
            onChange={(e) => updateField('right', e.target.value)}
          />
        </div>

        <div className="page-style-field">
          <label htmlFor="page-style-bottom">Bottom margin (mm)</label>
          <input
            id="page-style-bottom"
            type="number"
            min={0}
            max={60}
            value={form.bottom}
            onChange={(e) => updateField('bottom', e.target.value)}
          />
        </div>

        <div className="page-style-field">
          <label htmlFor="page-style-left">Left margin (mm)</label>
          <input
            id="page-style-left"
            type="number"
            min={0}
            max={60}
            value={form.left}
            onChange={(e) => updateField('left', e.target.value)}
          />
        </div>

        <div className="page-style-preview">
          <p
            style={{
              fontFamily: preview.font,
              fontSize: `${preview.size}pt`,
              lineHeight: preview.line,
            }}
          >
            Tiếng Việt: ắ ằ ẳ ẵ ặ ơ ư đ
          </p>
        </div>

        <div className="page-style-actions">
          <button
            type="button"
            onClick={() => setForm(defaultFormState())}
          >
            Reset to default
          </button>
        </div>
      </fieldset>
    </Dialog>
  )
}
