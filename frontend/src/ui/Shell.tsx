import { useCallback, useEffect } from 'react';
import { ChevronsRight, ChevronsLeft } from 'lucide-react';
import { useApp, initTheme } from '../state/store';
import { MenuBar } from './MenuBar';
import { EditorPane } from '../editor/EditorPane';

export function Shell() {
  const assistantWidth = useApp((s) => s.assistantWidth);
  const assistantCollapsed = useApp((s) => s.assistantCollapsed);
  const setAssistantWidth = useApp((s) => s.setAssistantWidth);
  const setAssistantCollapsed = useApp((s) => s.setAssistantCollapsed);
  const warnings = useApp((s) => s.warnings);
  const setWarnings = useApp((s) => s.setWarnings);
  const toast = useApp((s) => s.toast);

  // Init theme once on mount
  useEffect(() => {
    initTheme();
  }, []);

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
        <MenuBar onAction={() => {}} />
        <div className="toolbar-slot">Toolbar</div>
      </div>

      <div className="workspace">
        <div className="doc-pane">
          <EditorPane />
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
    </div>
  );
}
