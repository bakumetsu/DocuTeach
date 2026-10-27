import { useState } from 'react'
import { useApp } from '../../state/store'
import { setMeta } from '../../editor/docio'
import { updateMeta } from '../../markdown/frontmatter'
import { insertSplitPoint } from '../../editor/commands'
import { readPageStyle } from '../../editor/pageStyle'
import {
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
  const [, setTick] = useState(0)

  // Reset the config when the dialog opens or when the backing meta changes
  // while it is open. Done during render (not in an effect) to avoid
  // cascading renders from a synchronous setState inside an effect.
  const resetKey = open ? docMeta : null
  const [prevResetKey, setPrevResetKey] = useState<
    typeof docMeta | null
  >(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    if (open) {
      setCfg(readSplit(docMeta))
    }
  }

  const broken = Boolean(docMeta?.broken)
  const isPages = cfg.lessonType === 'lesson' && cfg.by === 'pages'
  const parsed = isPages ? parsePageRanges(cfg.ranges) : { ok: true, ranges: [] as [number, number][] }

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

  const files = fileList(cfg)
  const okDisabled =
    broken || !editor || (isPages && !parsed.ok)

  function setLessonType(value: 'lesson' | 'exam') {
    setCfg((prev) => {
      if (value === 'exam') {
        return { lessonType: 'exam', by: 'marker', ranges: '' }
      }
      return {
        lessonType: 'lesson',
        by: prev.by === 'pages' ? 'pages' : 'marker',
        ranges: prev.ranges,
      }
    })
  }

  function setBy(value: 'marker' | 'pages') {
    setCfg((prev) => ({ ...prev, by: value }))
  }

  function handleAddSplitPoint() {
    if (!editor) return
    insertSplitPoint(editor)
    setTick((t) => t + 1)
  }

  function handleOk() {
    if (!editor || broken) return
    if (isPages && !parsed.ok) return
    setMeta(editor, updateMeta(docMeta, splitToMeta(cfg)))
    onClose()
  }

  const showNoSplitPoint =
    cfg.lessonType === 'lesson' &&
    cfg.by === 'marker' &&
    editor !== null &&
    !hasSplitPoint(editor)

  return (
    <Dialog
      open={open}
      title="Split into files"
      onClose={onClose}
      onOk={handleOk}
      okDisabled={okDisabled}
    >
      {broken ? (
        <p role="alert">
          The front matter of this file is not valid YAML, so splitting is
          disabled.
        </p>
      ) : null}

      <fieldset disabled={broken}>
        <div className="split-type">
          <label>
            <input
              type="radio"
              name="split-lesson-type"
              value="lesson"
              checked={cfg.lessonType === 'lesson'}
              onChange={() => setLessonType('lesson')}
            />
            Lesson + Homework
          </label>
          <label>
            <input
              type="radio"
              name="split-lesson-type"
              value="exam"
              checked={cfg.lessonType === 'exam'}
              onChange={() => setLessonType('exam')}
            />
            Exam
          </label>
        </div>

        {cfg.lessonType === 'lesson' ? (
          <div className="split-by">
            <label>
              <input
                type="radio"
                name="split-by"
                value="marker"
                checked={cfg.by === 'marker'}
                onChange={() => setBy('marker')}
              />
              By split point
            </label>
            <label>
              <input
                type="radio"
                name="split-by"
                value="pages"
                checked={cfg.by === 'pages'}
                onChange={() => setBy('pages')}
              />
              By page ranges
            </label>
          </div>
        ) : null}

        {cfg.lessonType === 'lesson' && cfg.by === 'marker' ? (
          <div className="split-marker">
            {showNoSplitPoint ? (
              <>
                <p>No split point yet</p>
                <button
                  type="button"
                  onClick={handleAddSplitPoint}
                  disabled={!editor}
                >
                  Add one
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {isPages ? (
          <div className="split-ranges">
            <label htmlFor="split-ranges-input">Page ranges</label>
            <input
              id="split-ranges-input"
              type="text"
              value={cfg.ranges}
              onChange={(e) =>
                setCfg((prev) => ({ ...prev, ranges: e.target.value }))
              }
              placeholder="1-10, 11-20"
            />
            {parsed.error ? (
              <p role="alert">{parsed.error}</p>
            ) : null}
            {estimatedPages > 0 ? (
              <p>
                about {estimatedPages} page
                {estimatedPages === 1 ? '' : 's'}, exact after export
              </p>
            ) : null}
            {leftOut ? (
              <p>Pages left out: {leftOut}</p>
            ) : null}
          </div>
        ) : null}

        {cfg.lessonType === 'exam' ? (
          <div className="split-exam-files">
            <h3>Exam files</h3>
            <ul>
              {files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="split-file-list">
          <h3>Files the Export menu will produce</h3>
          <ul>
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </div>
      </fieldset>
    </Dialog>
  )
}
