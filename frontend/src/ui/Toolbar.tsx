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
} from 'lucide-react'
import { useApp } from '../state/store'
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
} from '../editor/formatting'
import { insertTeacherNote, insertMcq, insertBlank, insertSplitPoint } from '../editor/commands'

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

export function Toolbar() {
  useEditorToolbarState()

  const view = useApp((s) => s.view)
  const editor = useApp((s) => s.editor)
  const setDialog = useApp((s) => s.setDialog)

  const [activeIdx, setActiveIdx] = useState(0)
  const [open, setOpen] = useState<null | 'align' | 'table' | 'export'>(null)
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)

  const [alignAnchor, setAlignAnchor] = useState<HTMLElement | null>(null)
  const [tableAnchor, setTableAnchor] = useState<HTMLElement | null>(null)
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null)

  const barRef = useRef<HTMLDivElement>(null)

  const canEdit = view === 'edit'
  const ed = editor

  const fmt: Fmt = ed ? formatState(ed) : NO_FMT
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
  const doRevert = () => {
    if (!canEdit || !undoOk) return
    revert()
  }
  const doRedo = () => {
    if (!canEdit || !redoOk) return
    redo()
  }

  const AlignIcon = ALIGN_ICON[align]
  const dimEdit = !canEdit

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting" ref={barRef} onKeyDown={onBarKeyDown}>
      <select
        className="tb-select"
        aria-label="Paragraph style"
        value={fmt.block === 'other' ? '' : fmt.block}
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

      {btn(0, dimEdit, 'Bold', () => doFormat('bold'), <Bold size={16} />, { pressed: fmt.bold })}
      {btn(1, dimEdit, 'Italic', () => doFormat('italic'), <Italic size={16} />, { pressed: fmt.italic })}
      {btn(2, dimEdit, 'Underline', () => doFormat('underline'), <Underline size={16} />, { pressed: fmt.underline })}
      {btn(3, dimEdit, 'Highlight', () => doFormat('highlight'), <Highlighter size={16} />, { pressed: fmt.highlight })}

      <span className="tb-sep" aria-hidden="true" />

      {btn(4, dimEdit, 'Bullet list', () => doList('bullet'), <List size={16} />, { pressed: fmt.bullet })}
      {btn(5, dimEdit, 'Numbered list', () => doList('ordered'), <ListOrdered size={16} />, { pressed: fmt.ordered })}

      <span className="tb-sep" aria-hidden="true" />

      <button
        ref={setAlignAnchor}
        type="button"
        className={`tb-btn${dimEdit || !alignOk ? ' dim' : ''}`}
        tabIndex={6 === activeIdx ? 0 : -1}
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
        tabIndex={7 === activeIdx ? 0 : -1}
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

      {btn(8, dimEdit, 'Blank', doBlank, <SquareDashedBottom size={16} />)}
      {btn(9, dimEdit, 'Note', doNote, <StickyNote size={16} />)}
      {btn(10, dimEdit, 'Choice', doChoice, <ListChecks size={16} />)}
      {btn(11, dimEdit, 'Split', doSplit, <Scissors size={16} />, {
        title: hasSplit ? 'Go to the split point' : 'Add split point',
      })}

      <span className="tb-sep" aria-hidden="true" />

      {btn(12, !canEdit || !undoOk, 'Revert', doRevert, <Undo2 size={16} />, { title: 'Revert' })}
      {btn(13, !canEdit || !redoOk, 'Redo', doRedo, <Redo2 size={16} />, { title: 'Redo' })}

      <span className="tb-grow" aria-hidden="true" />

      {btn(14, false, 'Page style', () => setDialog('pageStyle'), <FileCog size={16} />)}

      <button
        ref={setExportAnchor}
        type="button"
        className="tb-btn dim"
        tabIndex={15 === activeIdx ? 0 : -1}
        aria-label="Export"
        title="Export"
        aria-haspopup="menu"
        aria-expanded={open === 'export'}
        aria-disabled="true"
        onClick={() => setOpen(open === 'export' ? null : 'export')}
      >
        <Download size={16} />
      </button>

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
        <div className="tb-menu">
          <div className="tb-menu-item disabled" aria-disabled="true">
            Student worksheet (PDF)
          </div>
          <div className="tb-menu-item disabled" aria-disabled="true">
            Teacher guide (DOCX)
          </div>
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
