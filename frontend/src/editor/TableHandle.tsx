import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Grid3x3 } from 'lucide-react';
import { useApp } from '../state/store';
import { selectTableCells } from './formatting';

interface HandlePos {
  top: number;
  left: number;
  pos: number;
}

export function TableHandle({ editor }: { editor: Editor | null }) {
  const view = useApp((s) => s.view);
  const [state, setState] = useState<HandlePos | null>(null);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const pageEl = dom.closest('.page');
    if (!pageEl) return;
    const page: Element = pageEl;

    function computeHandle(tableEl: Element) {
      const tableRect = tableEl.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const pos = editor!.view.posAtDOM(tableEl, 0);
      setState({
        top: tableRect.top - pageRect.top,
        left: tableRect.left - pageRect.left - 22,
        pos,
      });
    }

    function findTableForSelection(): Element | null {
      const { $from } = editor!.state.selection;
      const { node } = editor!.view.domAtPos($from.pos);
      const el = (node instanceof Element ? node : node.parentElement)?.closest('table') ?? null;
      if (el && dom.contains(el)) return el;
      return null;
    }

    function handleMouseOver(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const table = target.closest('table');
      if (table && dom.contains(table)) {
        computeHandle(table);
      }
    }

    function handleSelectionUpdate() {
      const table = findTableForSelection();
      if (table) {
        computeHandle(table);
      } else {
        setState(null);
      }
    }

    function handleMouseLeave() {
      const table = findTableForSelection();
      if (!table) {
        setState(null);
      }
    }

    function handleTransaction() {
      handleSelectionUpdate();
    }

    dom.addEventListener('mouseover', handleMouseOver);
    dom.addEventListener('mouseleave', handleMouseLeave);
    editor.on('selectionUpdate', handleSelectionUpdate);
    editor.on('transaction', handleTransaction);

    return () => {
      dom.removeEventListener('mouseover', handleMouseOver);
      dom.removeEventListener('mouseleave', handleMouseLeave);
      editor.off('selectionUpdate', handleSelectionUpdate);
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  if (!editor || !editor.isEditable || !state || view !== 'edit') {
    return null;
  }

  return (
    <button
      type="button"
      className="table-handle"
      aria-label="Select table"
      title="Select table"
      style={{ top: state.top, left: state.left }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => selectTableCells(editor, state.pos)}
    >
      <Grid3x3 size={14} />
    </button>
  );
}
