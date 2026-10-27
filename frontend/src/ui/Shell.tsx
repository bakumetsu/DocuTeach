import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronsRight, ChevronsLeft } from 'lucide-react';
import { useApp, initTheme } from '../state/store';
import { MenuBar } from './MenuBar';
import { Toolbar } from './Toolbar';
import { ViewTabs } from './ViewTabs';
import { EditorPane } from '../editor/EditorPane';
import { PreviewPane } from '../editor/PreviewPane';
import { PageStyleDialog } from './dialogs/PageStyleDialog';
import { SplitDialog } from './dialogs/SplitDialog';
import { ShortcutsDialog, AboutDialog } from './dialogs/HelpDialogs';
import { revert, redo } from '../editor/history';

export function Shell() {
  const assistantWidth = useApp((s) => s.assistantWidth);
  const assistantCollapsed = useApp((s) => s.assistantCollapsed);
  const setAssistantWidth = useApp((s) => s.setAssistantWidth);
  const setAssistantCollapsed = useApp((s) => s.setAssistantCollapsed);
  const warnings = useApp((s) => s.warnings);
  const setWarnings = useApp((s) => s.setWarnings);
  const toast = useApp((s) => s.toast);
  const view = useApp((s) => s.view);
  const dialog = useApp((s) => s.dialog);
  const setDialog = useApp((s) => s.setDialog);

  const docPaneRef = useRef<HTMLDivElement>(null);
  const scrollTops = useRef<Record<string, number>>({});

  // Init theme once on mount
  useEffect(() => {
    initTheme();
  }, []);

  // Save previous scroll, restore current on view change
  useLayoutEffect(() => {
    const pane = docPaneRef.current;
    if (!pane) return;

    const tops = scrollTops.current;

    // Restore scroll for the new view
    pane.scrollTop = tops[view] ?? 0;

    // On cleanup (before next view change), save the outgoing view's scroll
    return () => {
      tops[view] = pane.scrollTop;
    };
  }, [view]);

  // ── Menu bar actions ──────────────────────────────────────
  const handleMenuAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'edit.undo':
          revert();
          break;
        case 'edit.redo':
          redo();
          break;
        case 'tools.pageStyle':
          setDialog('pageStyle');
          break;
        case 'file.split':
          setDialog('split');
          break;
        case 'help.shortcuts':
          setDialog('shortcuts');
          break;
        case 'help.about':
          setDialog('about');
          break;
        case 'edit.checkpoints':
          setDialog('checkpoints');
          break;
        default:
          break;
      }
    },
    [setDialog],
  );

  // ── Gutter drag ────────────────────────────────────────────
  const handleGutterPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    },
    [],
  );

  const handleGutterPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!(e.buttons & 1)) return;
      const newWidth = window.innerWidth - e.clientX;
      const clamped = Math.max(280, Math.min(newWidth, window.innerWidth * 0.6));
      setAssistantWidth(clamped);
    },
    [setAssistantWidth],
  );

  const handleGutterPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      e.currentTarget.classList.remove('dragging');
    },
    [],
  );

  const handleGutterDoubleClick = useCallback(() => {
    setAssistantWidth(380);
  }, [setAssistantWidth]);

  // ── Collapse / expand ──────────────────────────────────────
  const toggleCollapse = useCallback(() => {
    setAssistantCollapsed(!assistantCollapsed);
  }, [assistantCollapsed, setAssistantCollapsed]);

  return (
    <div className="shell">
      <div className="topbars">
        <MenuBar onAction={handleMenuAction} />
        <Toolbar />
        <ViewTabs />
      </div>

      <div className="workspace">
        <div className="doc-pane" ref={docPaneRef}>
          <EditorPane hidden={view !== 'edit'} />
          {view !== 'edit' && <PreviewPane key={view} mode={view} />}
        </div>

        <div
          className="gutter"
          onPointerDown={handleGutterPointerDown}
          onPointerMove={handleGutterPointerMove}
          onPointerUp={handleGutterPointerUp}
          onDoubleClick={handleGutterDoubleClick}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize assistant panel"
        />

        <div
          className={`assistant-pane${assistantCollapsed ? ' collapsed' : ''}`}
          style={{ width: assistantCollapsed ? undefined : assistantWidth }}
        >
          <div className="pane-header">
            <span>Assistant</span>
            <button
              className="icon-btn"
              aria-label={assistantCollapsed ? 'Expand assistant' : 'Collapse assistant'}
              onClick={toggleCollapse}
            >
              {assistantCollapsed ? (
                <ChevronsLeft size={16} />
              ) : (
                <ChevronsRight size={16} />
              )}
            </button>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="warn-strip" role="status">
          <span>
            {warnings[0]}
            {warnings.length > 1 && (
              <span className="warn-count"> (+{warnings.length - 1} more)</span>
            )}
          </span>
          <button aria-label="Dismiss" onClick={() => setWarnings([])}>
            ✕
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <PageStyleDialog open={dialog === 'pageStyle'} onClose={() => setDialog(null)} />
      <SplitDialog open={dialog === 'split'} onClose={() => setDialog(null)} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={() => setDialog(null)} />
      <AboutDialog open={dialog === 'about'} onClose={() => setDialog(null)} />
    </div>
  );
}
