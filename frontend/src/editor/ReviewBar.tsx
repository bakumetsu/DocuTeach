import { useEffect, useReducer, useRef, useState, type ReactElement } from 'react';
import type { Editor } from '@tiptap/core';
import { Loader2, ChevronUp, ChevronDown, CheckCheck, X, Undo2 } from 'lucide-react';
import { getSuggestState, type Item } from './suggest/plugin';
import { hasBlockingFlag, stepFocus } from './suggest/card';
import { acceptAll, rejectAll, undoReject } from './suggest/apply';
import { useApp } from '../state/store';

const SKIPPED_REASONS: Record<string, string> = {
  protected_note: "Would change a teacher note: switch on 'Allow changes to notes and answers' to allow it",
  answer_changed: "Would change an answer: switch on 'Allow changes to notes and answers' to allow it",
  out_of_scope: 'Outside the chosen scope',
};

function skippedReason(code: string): string {
  return SKIPPED_REASONS[code] ?? 'Not applied';
}

export function acceptAllDisabled(items: Item[], running: boolean): boolean {
  if (running) return true;
  if (items.length === 0) return true;
  return items.some((item) => item.status === 'pending' && hasBlockingFlag(item));
}

export function ReviewBar({ editor }: { editor: Editor }): ReactElement | null {
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const [dismissed, setDismissed] = useState(false);
  const [lastRejected, setLastRejected] = useState<string[] | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const wasActiveRef = useRef(false);
  const prevRejectedLenRef = useRef(0);
  const rejectAllRef = useRef(false);

  // Subscribe to editor transactions
  useEffect(() => {
    const onTransaction = () => {
      const cur = getSuggestState(editor);
      const isActive = cur.items.length > 0 || cur.running;
      if (isActive && !wasActiveRef.current) setDismissed(false);
      wasActiveRef.current = isActive;
      const len = cur.rejected.length;
      const prevLen = prevRejectedLenRef.current;
      if (len > prevLen && !rejectAllRef.current) {
        setLastRejected([cur.rejected[len - 1].opId]);
      }
      if (len < prevLen && len === 0) setLastRejected(null);
      rejectAllRef.current = false;
      prevRejectedLenRef.current = len;
      bump();
    };
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  const s = getSuggestState(editor);

  // Auto-clear lastRejected after 8 s
  useEffect(() => {
    if (!lastRejected) return;
    const t = setTimeout(() => setLastRejected(null), 8000);
    return () => clearTimeout(t);
  }, [lastRejected]);

  const n = s.items.length;
  const staleCount = s.items.filter((i) => i.status === 'stale').length;
  const m = s.editSkipped.length;
  const reply = s.reply ?? '';
  const truncatedReply = reply.length > 120 ? reply.slice(0, 120) + '…' : reply;
  const acceptDisabled = acceptAllDisabled(s.items, s.running);
  const blockingDisabled =
    n > 0 && !s.running && s.items.some((i) => i.status === 'pending' && hasBlockingFlag(i));

  if (dismissed) return null;
  if (n === 0 && !s.running && !lastRejected) return null;

  return (
    <div className="review-bar" role="toolbar" aria-label="AI suggestions">
      {s.running && (
        <>
          <span className="review-spin">
            <Loader2 size={14} className="spin" />
          </span>
          <span className="review-part">
            {s.part ? `Part ${s.part}` : 'Working…'}
          </span>
        </>
      )}

      <span className="review-count" aria-live="polite">
        {n} suggestion{n === 1 ? '' : 's'}
      </span>
      {staleCount > 0 && (
        <span className="review-chip"> · {staleCount} stale</span>
      )}
      {m > 0 && (
        <button
          type="button"
          className="review-chip review-skipped"
          aria-label="Skipped suggestions"
          onClick={() => setShowSkipped(!showSkipped)}
        >
          {' '}· {m} skipped
        </button>
      )}
      {showSkipped && m > 0 && (
        <ul className="review-skipped-list">
          {s.editSkipped.map((sk, i) => (
            <li key={i}>
              {sk.header} — {skippedReason(sk.code)}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="icon-btn"
        title="Previous suggestion (Alt+Up)"
        aria-label="Previous suggestion (Alt+Up)"
        disabled={n === 0}
        onClick={() => stepFocus(editor, -1)}
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Next suggestion (Alt+Down)"
        aria-label="Next suggestion (Alt+Down)"
        disabled={n === 0}
        onClick={() => stepFocus(editor, 1)}
      >
        <ChevronDown size={16} />
      </button>

      <button
        type="button"
        className="icon-btn review-accept-all"
        aria-label="Accept all"
        title={
          blockingDisabled
            ? 'Accept all is off: review AI answers and large rewrites one by one'
            : 'Accept all'
        }
        disabled={acceptDisabled}
        onClick={() => {
          const r = acceptAll(editor);
          useApp.getState().showToast(
            r.left > 0
              ? `${r.applied} accepted · ${r.left} left: lesson changed`
              : `${r.applied} accepted`,
          );
        }}
      >
        <CheckCheck size={16} />
      </button>

      <button
        type="button"
        className="icon-btn review-reject-all"
        aria-label="Reject all"
        title="Reject all"
        disabled={n === 0}
        onClick={() => {
          const ids = s.items.map((i) => i.opId);
          rejectAllRef.current = true;
          rejectAll(editor);
          setLastRejected(ids);
          useApp.getState().showToast(`${ids.length} rejected`);
        }}
      >
        <X size={16} />
      </button>

      {lastRejected && lastRejected.length > 0 && (
        <button
          type="button"
          className="review-undo"
          title="Undo reject"
          onClick={() => {
            undoReject(editor, lastRejected);
            setLastRejected(null);
          }}
        >
          <Undo2 size={14} />
          {' Undo'}
        </button>
      )}

      {reply !== '' && (
        <span className="review-reply" title={reply}>
          {truncatedReply}
        </span>
      )}

      {n === 0 && !s.running && (
        <button
          type="button"
          className="icon-btn review-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => setDismissed(true)}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
