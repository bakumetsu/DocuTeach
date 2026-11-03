import { useEffect, useReducer, useRef, useState } from 'react'
import {
  Bold,
  Italic,
  Underline,
  Highlighter,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Table as TableIcon,
  Minus,
  Plus,
  SquareDashedBottom,
  StickyNote,
  ListChecks,
  Scissors,
  Undo2,
  Redo2,
  FileCog,
  Download,
  Rows3,
  Columns3,
  Trash2,
  FileText,
  BookOpen,
  Type,
  ChevronDown,
} from 'lucide-react'
import { useApp } from '../state/store'
import { ApiError } from '../api/types'
import { Popover } from './Popover'
import { revert, redo, canUndo, canRedo } from '../editor/history'
import {
  toggleFormat,
  setBlock,
  toggleList,
  canAlign,
  setAlign,
  currentAlign,
  insertTable,
  tableOp,
  inTable,
  formatState,
  setFont,
  setSize,
  SIZE_PRESETS,
} from '../editor/formatting'
import { FONTS } from '../editor/fontStyle'
import { readPageStyle } from '../editor/pageStyle'
import { insertTeacherNote, insertMcq, insertBlank, insertSplitPoint } from '../editor/commands'
import { loadExportPlan, runExport } from '../files/exportActions'
import type { ExportPart, ExportTarget } from '../api/types'

type Align = 'left' | 'center' | 'right' | 'justify'
type Block = 'paragraph' | 'h1' | 'h2'
type ListKind = 'bullet' | 'ordered'
type TableOpKind = 'addRow' | 'addColumn' | 'deleteRow' | 'deleteColumn' | 'deleteTable'

type Fmt = ReturnType<typeof formatState>

const NO_FMT: Fmt = {
  bold: false,
  italic: false,
  underline: false,
  highlight: false,
  bullet: false,
  ordered: false,
  block: 'paragraph',
  align: 'left',
  inTable: false,
  canAlign: false,
  canUndo: false,
  canRedo: false,
  font: null,
  size: null,
}

const ALIGN_ICON: Record<Align, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
}

const ALIGNS: Align[] = ['left', 'center', 'right', 'justify']

// Re-renders the toolbar whenever the editor emits a transaction or a
// selection change so that pressed/disabled state stays in sync.
function useEditorToolbarState(): void {
  const editor = useApp((s) => s.editor)
  const [, force] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    if (!editor) return
    const onTx = () => force()
    const onSel = () => force()
    editor.on('transaction', onTx)
    editor.on('selectionUpdate', onSel)
    return () => {
      editor.off('transaction', onTx)
      editor.off('selectionUpdate', onSel)
    }
  }, [editor])
}

function exportLabel(part: ExportPart, target: ExportTarget): string {
  const kind = target === 'student_pdf' ? 'PDF' : 'DOCX'
  if (part.targets.length > 1)
    return target === 'student_pdf' ? 'Student worksheet (PDF)' : 'Teacher guide (DOCX)'
  return `${part.label} (${kind})`
}

export function Toolbar() {
  useEditorToolbarState()

  const view = useApp((s) => s.view)
  const editor = useApp((s) => s.editor)
  const setDialog = useApp((s) => s.setDialog)
  const docMeta = useApp((s) => s.docMeta)

  const [activeIdx, setActiveIdx] = useState(0)
  const [open, setOpen] = useState<null | 'font' | 'size' | 'align' | 'table' | 'export'>(null)
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)

  const [alignAnchor, setAlignAnchor] = useState<HTMLElement | null>(null)
  const [tableAnchor, setTableAnchor] = useState<HTMLElement | null>(null)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)
  const [fontAnchor, setFontAnchor] = useState<HTMLElement | null>(null)
  const [sizeAnchor, setSizeAnchor] = useState<HTMLElement | null>(null)
  const [plan, setPlan] = useState<ExportPart[] | null>(null)

  const barRef = useRef<HTMLDivElement>(null)

  const canEdit = view === 'edit'
  const ed = editor

  const fmt: Fmt = ed ? formatState(ed) : NO_FMT
  const page = readPageStyle(docMeta)
  const align: Align = ed ? currentAlign(ed) : 'left'
  const alignOk = ed ? canAlign(ed) : false
  const inTbl = ed ? inTable(ed) : false
  const undoOk = canUndo()
  const redoOk = canRedo()

  const hasSplit = (() => {
    if (!ed) return false
    let found = false
    ed.state.doc.descendants((n: { type: { name: string } }) => {
      if (n.type.name === 'splitPoint') {
        found = true
        return false
      }
      return true
    })
    return found
  })()

  const btn = (
    idx: number,
    dim: boolean,
    label: string,
    onClick: () => void,
    children: React.ReactNode,
    extra: { title?: string; pressed?: boolean } = {},
  ) => (
    <button
      key={idx}
      type="button"
      className={`tb-btn${dim ? ' dim' : ''}`}
      tabIndex={idx === activeIdx ? 0 : -1}
      aria-label={label}
      title={extra.title ?? label}
      aria-pressed={extra.pressed}
      aria-disabled={dim || undefined}
      onClick={() => {
        if (dim) return
        onClick()
      }}
    >
      {children}
    </button>
  )

  const onBarKeyDown = (e: React.KeyboardEvent) => {
    const bar = barRef.current
    if (!bar) return
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('.tb-btn'))
    if (buttons.length === 0) return
    const cur = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const base = cur === -1 ? activeIdx : cur
    let next: number
    if (e.key === 'ArrowRight') next = (base + 1) % buttons.length
    else if (e.key === 'ArrowLeft') next = (base - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = buttons.length - 1
    else return
    e.preventDefault()
    buttons[next].focus()
    setActiveIdx(next)
  }

  const doFormat = (f: 'bold' | 'italic' | 'underline' | 'highlight') => {
    if (!ed || !canEdit) return
    toggleFormat(ed, f)
  }
  const doBlock = (b: Block) => {
    if (!ed || !canEdit) return
    setBlock(ed, b)
  }
  const doList = (l: ListKind) => {
    if (!ed || !canEdit) return
    toggleList(ed, l)
  }
  const doAlign = (a: Align) => {
    if (!ed || !canEdit) return
    setAlign(ed, a)
    setOpen(null)
  }
  const doTableInsert = () => {
    if (!ed || !canEdit) return
    insertTable(ed, rows, cols)
    setOpen(null)
  }
  const doTableOp = (op: TableOpKind) => {
    if (!ed || !canEdit) return
    tableOp(ed, op)
  }
  const doBlank = () => {
    if (!ed || !canEdit) return
    const pos = insertBlank(ed)
    if (pos >= 0) {
      window.dispatchEvent(new CustomEvent('docuteach:open-blank', { detail: { pos } }))
    }
  }
  const doNote = () => {
    if (!ed || !canEdit) return
    insertTeacherNote(ed)
  }
  const doChoice = () => {
    if (!ed || !canEdit) return
    insertMcq(ed)
  }
  const doSplit = () => {
    if (!ed || !canEdit) return
    insertSplitPoint(ed)
  }
  const doFont = (name: string | null) => {
    if (!ed || !canEdit) return
    setFont(ed, name)
    setOpen(null)
  }
  const doSize = (n: number | null) => {
    if (!ed || !canEdit) return
    setSize(ed, n)
    setOpen(null)
  }
  const doRevert = () => {
    if (!canEdit || !undoOk) return
    revert()
  }
  const doRedo = () => {
    if (!canEdit || !redoOk) return
    redo()
  }
  const loadPlan = () => {
    setPlan(null)
    loadExportPlan()
      .then(setPlan)
      .catch((err: unknown) => {
        useApp.getState().showToast(err instanceof ApiError ? err.message : 'Could not prepare the export')
        setPlan([])
      })
  }

  const AlignIcon = ALIGN_ICON[align]
  const dimEdit = !canEdit

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting" ref={barRef} onKeyDown={onBarKeyDown}>
      <select
        className="tb-select"
        aria-label="Paragraph style"
        disabled={!canEdit}
        value={canEdit ? (fmt.block === 'other' ? '' : fmt.block) : ''}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'paragraph' || v === 'h1' || v === 'h2') {
            doBlock(v)
          }
        }}
      >
        <option value="" disabled hidden />
        <option value="paragraph">Normal</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
      </select>

      <span className="tb-sep" aria-hidden="true" />

      <button
        ref={setFontAnchor}
        type="button"
        className={`tb-btn tb-font${dimEdit ? ' dim' : ''}`}
        tabIndex={0 === activeIdx ? 0 : -1}
        aria-label="Font"
        title={`Font: ${fmt.font === 'mixed' ? 'mixed' : typeof fmt.font === 'string' ? fmt.font : `${page.font} (default)`}`}
        aria-haspopup="menu"
        aria-expanded={open === 'font'}
        aria-disabled={dimEdit || undefined}
        data-set={typeof fmt.font === 'string' ? 'true' : undefined}
        onClick={() => {
          if (dimEdit) return
          setOpen(open === 'font' ? null : 'font')
        }}
      >
        <Type size={16} />
        <ChevronDown size={12} />
      </button>

      <button
        ref={setSizeAnchor}
        type="button"
        className={`tb-btn tb-size${dimEdit ? ' dim' : ''}`}
        tabIndex={1 === activeIdx ? 0 : -1}
        aria-label="Size"
        title={`Size: ${fmt.size === 'mixed' ? 'mixed' : typeof fmt.size === 'number' ? String(fmt.size) : `${page.size} (default)`}`}
        aria-haspopup="menu"
        aria-expanded={open === 'size'}
        aria-disabled={dimEdit || undefined}
        onClick={() => {
          if (dimEdit) return
          setOpen(open === 'size' ? null : 'size')
        }}
      >
        <span className={`tb-size-val${fmt.size === null ? ' muted' : ''}`}>
          {fmt.size === 'mixed' ? '' : fmt.size ?? page.size}
        </span>
        <ChevronDown size={12} />
      </button>

      <span className="tb-sep" aria-hidden="true" />

      {btn(2, dimEdit, 'Bold', () => doFormat('bold'), <Bold size={16} />, { pressed: fmt.bold })}
      {btn(3, dimEdit, 'Italic', () => doFormat('italic'), <Italic size={16} />, { pressed: fmt.italic })}
      {btn(4, dimEdit, 'Underline', () => doFormat('underline'), <Underline size={16} />, { pressed: fmt.underline })}
      {btn(5, dimEdit, 'Highlight', () => doFormat('highlight'), <Highlighter size={16} />, { pressed: fmt.highlight })}

      <span className="tb-sep" aria-hidden="true" />

      {btn(6, dimEdit, 'Bullet list', () => doList('bullet'), <List size={16} />, { pressed: fmt.bullet })}
      {btn(7, dimEdit, 'Numbered list', () => doList('ordered'), <ListOrdered size={16} />, { pressed: fmt.ordered })}

      <span className="tb-sep" aria-hidden="true" />

      <button
        ref={setAlignAnchor}
        type="button"
        className={`tb-btn${dimEdit || !alignOk ? ' dim' : ''}`}
        tabIndex={8 === activeIdx ? 0 : -1}
        aria-label="Align"
        title={alignOk ? 'Alignment' : 'Alignment works on top-level paragraphs and headings'}
        aria-haspopup="menu"
        aria-expanded={open === 'align'}
        aria-disabled={dimEdit || !alignOk || undefined}
        onClick={() => {
          if (dimEdit || !alignOk) return
          setOpen(open === 'align' ? null : 'align')
        }}
      >
        <AlignIcon size={16} />
      </button>

      <button
        ref={setTableAnchor}
        type="button"
        className={`tb-btn${dimEdit ? ' dim' : ''}`}
        tabIndex={9 === activeIdx ? 0 : -1}
        aria-label="Table"
        title="Table"
        aria-haspopup="menu"
        aria-expanded={open === 'table'}
        aria-disabled={dimEdit || undefined}
        onClick={() => {
          if (dimEdit) return
          setOpen(open === 'table' ? null : 'table')
        }}
      >
        <TableIcon size={16} />
      </button>

      <span className="tb-sep" aria-hidden="true" />

      {btn(10, dimEdit, 'Blank', doBlank, <SquareDashedBottom size={16} />)}
      {btn(11, dimEdit, 'Note', doNote, <StickyNote size={16} />)}
      {btn(12, dimEdit, 'Choice', doChoice, <ListChecks size={16} />)}
      {btn(13, dimEdit, 'Split', doSplit, <Scissors size={16} />, {
        title: hasSplit ? 'Go to the split point' : 'Add split point',
      })}

      <span className="tb-sep" aria-hidden="true" />

      {btn(14, !canEdit || !undoOk, 'Revert', doRevert, <Undo2 size={16} />, { title: 'Revert' })}
      {btn(15, !canEdit || !redoOk, 'Redo', doRedo, <Redo2 size={16} />, { title: 'Redo' })}

      <span className="tb-grow" aria-hidden="true" />

      {btn(16, false, 'Page style', () => setDialog('pageStyle'), <FileCog size={16} />)}

      <button
        ref={setExportAnchor}
        type="button"
        className="tb-btn"
        tabIndex={17 === activeIdx ? 0 : -1}
        aria-label="Export"
        title="Export"
        aria-haspopup="menu"
        aria-expanded={open === 'export'}
        onClick={() => {
          const next = open === 'export' ? null : 'export'
          setOpen(next)
          if (next === 'export') loadPlan()
        }}
      >
        <Download size={16} />
      </button>

      <Popover anchor={fontAnchor} open={open === 'font'} onClose={() => setOpen(null)}>
        <div className="tb-menu" role="menu" aria-label="Font list">
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => doFont(null)}>
            <span className="tb-check" aria-hidden="true">{fmt.font === null ? '✓' : ''}</span>
            <span>Default</span>
          </button>
          {FONTS.map((f) => (
            <button
              key={f.name}
              type="button"
              role="menuitem"
              className="tb-menu-item"
              style={{ fontFamily: f.stack }}
              aria-label={f.name}
              onClick={() => doFont(f.name)}
            >
              <span className="tb-check" aria-hidden="true">{fmt.font === f.name ? '✓' : ''}</span>
              <span>{f.name}</span>
            </button>
          ))}
          {typeof fmt.font === 'string' && !FONTS.some((f) => f.name === fmt.font) && (
            <button type="button" role="menuitem" className="tb-menu-item">
              <span className="tb-check" aria-hidden="true">✓</span>
              <span>{fmt.font} (not bundled)</span>
            </button>
          )}
        </div>
      </Popover>

      <Popover anchor={sizeAnchor} open={open === 'size'} onClose={() => setOpen(null)}>
        <div className="tb-menu" role="menu" aria-label="Size list">
          <button type="button" role="menuitem" className="tb-menu-item" onClick={() => doSize(null)}>
            <span className="tb-check" aria-hidden="true">{fmt.size === null ? '✓' : ''}</span>
            <span>Default</span>
          </button>
          {SIZE_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitem"
              className="tb-menu-item"
              aria-label={`${n} pt`}
              onClick={() => doSize(n)}
            >
              <span className="tb-check" aria-hidden="true">{fmt.size === n ? '✓' : ''}</span>
              <span>{String(n)}</span>
            </button>
          ))}
          {typeof fmt.size === 'number' && !SIZE_PRESETS.includes(fmt.size) && (
            <button type="button" role="menuitem" className="tb-menu-item" aria-label={`${fmt.size} pt`}>
              <span className="tb-check" aria-hidden="true">✓</span>
              <span>{String(fmt.size)}</span>
            </button>
          )}
        </div>
      </Popover>

      <Popover anchor={alignAnchor} open={open === 'align'} onClose={() => setOpen(null)}>
        <div className="tb-menu" role="menu" aria-label="Alignment">
          {ALIGNS.map((a) => {
            const I = ALIGN_ICON[a]
            return (
              <button
                key={a}
                type="button"
                role="menuitem"
                className="tb-menu-item"
                aria-label={`Align ${a}`}
                title={`Align ${a}`}
                onClick={() => doAlign(a)}
              >
                <I size={16} />
              </button>
            )
          })}
        </div>
      </Popover>

      <Popover anchor={tableAnchor} open={open === 'table'} onClose={() => setOpen(null)}>
        <div className="tb-menu">
          {inTbl ? (
            <div className="tb-table-ops">
              <button type="button" className="tb-btn" aria-label="Add row" title="Add row" onClick={() => doTableOp('addRow')}>
                <Rows3 size={16} />
                <Plus size={12} />
              </button>
              <button type="button" className="tb-btn" aria-label="Add column" title="Add column" onClick={() => doTableOp('addColumn')}>
                <Columns3 size={16} />
                <Plus size={12} />
              </button>
              <button type="button" className="tb-btn" aria-label="Delete row" title="Delete row" onClick={() => doTableOp('deleteRow')}>
                <Rows3 size={16} />
                <Minus size={12} />
              </button>
              <button type="button" className="tb-btn" aria-label="Delete column" title="Delete column" onClick={() => doTableOp('deleteColumn')}>
                <Columns3 size={16} />
                <Minus size={12} />
              </button>
              <button type="button" className="tb-btn" aria-label="Delete table" title="Delete table" onClick={() => doTableOp('deleteTable')}>
                <Trash2 size={16} />
              </button>
            </div>
          ) : (
            <div className="tb-table-new">
              <label>
                Rows
                <input
                  type="number"
                  min={1}
                  value={rows}
                  onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label>
                Columns
                <input
                  type="number"
                  min={1}
                  value={cols}
                  onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <button type="button" className="tb-insert" onClick={doTableInsert}>
                Insert
              </button>
            </div>
          )}
        </div>
      </Popover>

      <Popover anchor={exportAnchor} open={open === 'export'} onClose={() => setOpen(null)}>
        <div className="tb-menu" role="menu" aria-label="Export">
          {plan === null ? (
            <div className="tb-menu-item disabled" aria-disabled="true">Preparing…</div>
          ) : plan.length === 0 ? (
            <div className="tb-menu-item disabled" aria-disabled="true">Export is not available</div>
          ) : (
            plan.flatMap((part) =>
              part.targets.map((target) => (
                <button
                  type="button"
                  role="menuitem"
                  className="tb-menu-item"
                  key={`${part.label}-${target}`}
                  onClick={() => {
                    setOpen(null)
                    void runExport(part, target)
                  }}
                >
                  {target === 'student_pdf' ? <FileText size={16} /> : <BookOpen size={16} />}
                  <span>{exportLabel(part, target)}</span>
                </button>
              )),
            )
          )}
          <div className="dialog-footer">
            <button type="button" className="tb-insert" onClick={() => setDialog('split')}>
              Split into files…
            </button>
          </div>
        </div>
      </Popover>
    </div>
  )
}
