import { useState, useRef, useId } from 'react'
import { Scissors, FileStack, PenLine, FileText, BookOpen } from 'lucide-react'
import { useApp } from '../../state/store'
import { setMeta } from '../../editor/docio'
import { updateMeta } from '../../markdown/frontmatter'
import { insertSplitPoint } from '../../editor/commands'
import { readPageStyle } from '../../editor/pageStyle'
import {
  configFor,
  modeOf,
  estimatePages,
  fileList,
  parsePageRanges,
  pagesLeftOut,
  readSplit,
  splitToMeta,
  type SplitConfig,
} from '../../editor/splitConfig'
import { Dialog } from './Dialog'

type EditorLike = Parameters<typeof insertSplitPoint>[0]

function hasSplitPoint(editor: EditorLike): boolean {
  const doc = editor.state.doc as unknown as {
    descendants?: (
      cb: (node: { type: { name: string } }) => boolean | void,
    ) => void
    toJSON?: () => unknown
  }

  let found = false

  if (typeof doc.descendants === 'function') {
    doc.descendants((node) => {
      const name = node.type.name
      if (
        name === 'splitPoint' ||
        name === 'split_point' ||
        name === 'split'
      ) {
        found = true
        return false
      }
      return true
    })
  }

  if (!found && typeof doc.toJSON === 'function') {
    const json = JSON.stringify(doc.toJSON() ?? null)
    found =
      json.includes('"splitPoint"') ||
      json.includes('"split_point"') ||
      json.includes('split-point')
  }

  return found
}

export function SplitDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { editor, docMeta } = useApp()
  const [cfg, setCfg] = useState<SplitConfig>(() => readSplit(docMeta))
  const [draft, setDraft] = useState<string>(() => readSplit(docMeta).ranges)
  const [touched, setTouched] = useState(false)
  const [, setTick] = useState(0)
  const selectedRef = useRef<HTMLInputElement | null>(null)

  // Reset state when the dialog opens or when the backing meta changes
  // while it is open. Done during render (not in an effect) to avoid
  // cascading renders from a synchronous setState inside an effect.
  const resetKey = open ? docMeta : null
  const [prevResetKey, setPrevResetKey] = useState<typeof docMeta | null>(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    if (open) {
      const fresh = readSplit(docMeta)
      setCfg(fresh)
      setDraft(fresh.ranges)
      setTouched(false)
    }
  }

  const broken = Boolean(docMeta?.broken)
  const mode = modeOf(cfg)
  const isPages = mode === 'pages'
  const parsed = isPages
    ? parsePageRanges(draft)
    : { ok: true, ranges: [] as [number, number][], error: '' }

  let estimatedPages = 0
  if (isPages && parsed.ok) {
    const content =
      typeof document !== 'undefined'
        ? document.querySelector('.page-content')
        : null
    if (content) {
      estimatedPages = estimatePages(
        content.getBoundingClientRect().height,
        readPageStyle(docMeta),
      )
    }
  }

  const leftOut =
    isPages && parsed.ok && estimatedPages > 0
      ? pagesLeftOut(parsed.ranges, estimatedPages)
      : ''
  const maxEnd =
    isPages && parsed.ok
      ? parsed.ranges.reduce((m, [, end]) => Math.max(m, end), 0)
      : 0

  const files = fileList(cfg)
  const hasSP = editor !== null ? hasSplitPoint(editor) : false
  const displayFiles =
    mode === 'marker' && !hasSP
      ? files.filter((f) => f !== 'Homework (student PDF)')
      : files

  const showError =
    (touched && !parsed.ok && draft.trim() !== '') ||
    (touched && draft.trim() === '')

  const okDisabled =
    broken || !editor || (mode === 'pages' && !parsed.ok)

  // Stable ids for accessibility
  const markerTitleId = useId()
  const markerDescId = useId()
  const pagesTitleId = useId()
  const pagesDescId = useId()
  const examTitleId = useId()
  const examDescId = useId()
  const rangesInputId = useId()

  function selectMode(m: 'marker' | 'pages' | 'exam') {
    setCfg(configFor(m, draft))
  }

  function handleDraftChange(value: string) {
    setDraft(value)
    setCfg(configFor('pages', value))
    setTouched(true)
  }

  function handleShowSplit() {
    if (!editor) return
    insertSplitPoint(editor)
    onClose()
  }

  function handleAddSplitPoint() {
    if (!editor) return
    insertSplitPoint(editor)
    setTick((t) => t + 1)
  }

  function handleOk() {
    if (!editor || broken) return
    if (mode === 'pages' && !parsed.ok) return
    setMeta(editor, updateMeta(docMeta, splitToMeta(cfg)))
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="Split into files"
      onClose={onClose}
      onOk={handleOk}
      okDisabled={okDisabled}
      footerNote="OK saves the choice. Make the files from Export."
      initialFocus={selectedRef}
    >
      <p className="split-sub">Choose how this document becomes files.</p>

      {broken ? (
        <p role="alert" className="split-error">
          The front matter is not valid YAML, so splitting is disabled. Fix it
          in the document, then reopen.
        </p>
      ) : null}

      <fieldset
        disabled={broken || !editor}
        className="split-cards"
        aria-label="How to split"
      >
        <label className="split-card" data-checked={mode === 'marker'}>
          <input
            type="radio"
            name="split-mode"
            className="split-radio"
            checked={mode === 'marker'}
            onChange={() => selectMode('marker')}
            aria-labelledby={markerTitleId}
            aria-describedby={markerDescId}
            ref={mode === 'marker' ? selectedRef : undefined}
          />
          <span className="split-icon">
            <Scissors size={18} />
          </span>
          <span>
            <b id={markerTitleId}>Lesson + Homework, at a split point</b>
            <span id={markerDescId} className="split-desc">
              You mark where the lesson ends and homework starts.
            </span>
          </span>
        </label>

        <label className="split-card" data-checked={mode === 'pages'}>
          <input
            type="radio"
            name="split-mode"
            className="split-radio"
            checked={mode === 'pages'}
            onChange={() => selectMode('pages')}
            aria-labelledby={pagesTitleId}
            aria-describedby={pagesDescId}
            ref={mode === 'pages' ? selectedRef : undefined}
          />
          <span className="split-icon">
            <FileStack size={18} />
          </span>
          <span>
            <b id={pagesTitleId}>Lesson + Homework, by page ranges</b>
            <span id={pagesDescId} className="split-desc">
              You type page numbers; each range is its own PDF.
            </span>
          </span>
        </label>

        <label className="split-card" data-checked={mode === 'exam'}>
          <input
            type="radio"
            name="split-mode"
            className="split-radio"
            checked={mode === 'exam'}
            onChange={() => selectMode('exam')}
            aria-labelledby={examTitleId}
            aria-describedby={examDescId}
            ref={mode === 'exam' ? selectedRef : undefined}
          />
          <span className="split-icon">
            <PenLine size={18} />
          </span>
          <span>
            <b id={examTitleId}>Exam</b>
            <span id={examDescId} className="split-desc">
              One student paper and one teacher copy. No split.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="split-detail">
        {mode === 'marker' ? (
          hasSP ? (
            <div className="split-marker-set">
              <span>Split point set</span>
              <button type="button" onClick={handleShowSplit}>
                Show it
              </button>
            </div>
          ) : (
            <div className="split-marker-none">
              <span>No split point yet.</span>
              <button
                type="button"
                onClick={handleAddSplitPoint}
                disabled={!editor}
              >
                {'\uFF0B'} Add at cursor
              </button>
              <p className="split-muted">
                Adds it where your cursor was. Undo with Ctrl+Z in the editor.
                To choose another spot, close this and use the scissors button.
              </p>
            </div>
          )
        ) : null}

        {mode === 'pages' ? (
          <div className="split-ranges">
            <label htmlFor={rangesInputId}>Page ranges</label>
            <input
              id={rangesInputId}
              type="text"
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleOk()
              }}
              placeholder="1-10, 11-20"
              aria-invalid={showError ? true : undefined}
              className={showError ? 'bad' : undefined}
            />
            <p className="split-muted">
              Example: 1-10, 11-20. Pages as in the exported PDF
              {estimatedPages > 0
                ? ` (about ${estimatedPages} pages, exact after export)`
                : ''}
              .
            </p>
            {showError ? (
              <p role="alert" className="split-error">
                {parsed.error}
              </p>
            ) : null}
            {parsed.ok && estimatedPages > 0 ? (
              <>
                {leftOut ? (
                  <p className="split-warn">
                    Pages left out: {leftOut}. They will not be in any file.
                  </p>
                ) : null}
                {maxEnd > estimatedPages ? (
                  <p className="split-warn">
                    Ranges go past about {estimatedPages} pages
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {mode === 'exam' ? (
          <p className="split-muted">Exam papers are not split.</p>
        ) : null}
      </div>

      <div className="split-files">
        <small>Export will make</small>
        {mode === 'pages' && !parsed.ok ? (
          <>
            <p className="split-muted">
              {draft.trim() === ''
                ? 'Type page ranges to see the files.'
                : 'Fix the ranges to see the files.'}
            </p>
            <div className="split-file">
              <BookOpen size={16} />
              <span>Teacher guide (DOCX)</span>
            </div>
          </>
        ) : (
          displayFiles.map((file) => (
            <div key={file} className="split-file">
              {file.endsWith('(PDF)') || file.includes('student PDF') ? (
                <FileText size={16} />
              ) : (
                <BookOpen size={16} />
              )}
              <span>{file}</span>
            </div>
          ))
        )}
        {mode === 'marker' && !hasSP ? (
          <p className="split-muted">
            Add a split point to get a separate Homework file.
          </p>
        ) : null}
        {mode === 'pages' ? (
          <p className="split-muted">
            Page ranges split the student PDF only; the teacher guide stays
            one file.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
