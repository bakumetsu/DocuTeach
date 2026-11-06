import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Send, Square, Plus, CornerUpLeft, Pencil, Lock, LockOpen, ShieldAlert } from 'lucide-react';
import { replyWithSelection } from './reply';
import { useChats } from './chatStore';
import { useEditEntry } from './editEntry';
import { useApp } from '../state/store';
import { insertFromChat } from './pageBridge';
import { SlashList } from './SlashList';
import { api } from '../api';
import type { ContextInfo } from '../api/types';
import { contextUsage, contextTooltip } from './contextUsage';
import { ContextRing } from './ContextRing';

export function ChatView() {
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const inputs = useChats((s) => s.inputs);
  const setInput = useChats((s) => s.setInput);
  const send = useChats((s) => s.send);
  const stop = useChats((s) => s.stop);
  const modelStatus = useChats((s) => s.modelStatus);
  const skills = useChats((s) => s.skills);
  const attachText = useChats((s) => s.attachText);
  const removeRef = useChats((s) => s.removeRef);
  const focusNonce = useChats((s) => s.focusNonce);

  const view = useApp((s) => s.view);
  const showToast = useApp((s) => s.showToast);

  const chat = chats.find((c) => c.id === activeId);

  const [activeIndex, setActiveIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [replyAt, setReplyAt] = useState<{ text: string; top: number; left: number } | null>(null);
  const [ctxInfo, setCtxInfo] = useState<ContextInfo | null>(null);

  const msgRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const input = inputs[activeId] ?? '';
  const isEdit = view === 'edit';

  const entry = useEditEntry((s) => s.byChat[activeId]);
  const hasSel = useEditEntry((s) => s.hasSelection);
  const allowProtected = useEditEntry((s) => s.allowProtected);
  const scope = entry?.scope ?? (hasSel ? 'selection' : 'lesson');

  // Slash list logic: derived from the current input value during render.
  const slashQuery = input.startsWith('/') ? input.split(/\s/)[0] : null;
  const slashOpen = slashQuery !== null && !slashDismissed;

  const activeSkills =
    slashQuery === null
      ? []
      : skills.filter((s) => s.status === 'active' && s.command.startsWith(slashQuery));

  const safeActiveIndex =
    activeSkills.length === 0 ? 0 : Math.min(activeIndex, activeSkills.length - 1);

  // Scroll to bottom on messages change
  useEffect(() => {
    if (msgRef.current) {
      msgRef.current.scrollTop = msgRef.current.scrollHeight;
    }
  }, [chat?.messages]);

  useEffect(() => {
    if (focusNonce > 0) inputRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    const model = chat?.model;
    if (!model) return;
    let cancelled = false;
    api.models.context(model).then((info) => {
      if (!cancelled) setCtxInfo(info);
    }).catch(() => {
      if (!cancelled) setCtxInfo(null);
    });
    return () => { cancelled = true; };
  }, [chat?.model]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    setInput(activeId, nextValue);

    const nextSlashQuery = nextValue.startsWith('/') ? nextValue.split(/\s/)[0] : null;
    if (nextSlashQuery !== slashQuery) {
      setActiveIndex(0);
      if (nextSlashQuery !== null) {
        setSlashDismissed(false);
      }
    }
  };

  const handlePick = useCallback(
    (command: string) => {
      setInput(activeId, command + ' ');
      setSlashDismissed(true);
    },
    [activeId, setInput],
  );

  const doSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;

    // Skill command guard: refuse outside Edit view
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const cmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const isSkill = skills.some((s) => s.command === cmd && s.status === 'active');
      if ((isSkill || text.startsWith('/edit')) && !isEdit) {
        showToast('Page drafts work in Edit view');
        return;
      }
    }
    if (entry?.on && !isEdit) {
      showToast('Page drafts work in Edit view');
      return;
    }

    setInput(activeId, '');
    setSlashDismissed(true);
    void send(activeId, text);
  }, [input, activeId, isEdit, skills, showToast, setInput, send, entry]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && activeSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % activeSkills.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + activeSkills.length) % activeSkills.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handlePick(activeSkills[safeActiveIndex].command);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'txt' || ext === 'md' || ext === 'csv') {
      const text = await file.text();
      attachText(activeId, file.name, text);
    } else if (ext === 'pdf' || ext === 'docx') {
      showToast('Needs the backend (later)');
    }
    e.target.value = '';
  };

  const handleMsgMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString();
    const node = sel.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    if (!text.trim() || !el?.closest('.msg-content')) return;
    const box = msgRef.current;
    const r = sel.getRangeAt(0).getBoundingClientRect?.();
    const b = box?.getBoundingClientRect();
    setReplyAt({
      text,
      top: r && b ? r.top - b.top + (box?.scrollTop ?? 0) - 30 : 0,
      left: r && b ? r.left - b.left : 0,
    });
  };

  if (!chat) return null;

  const ms = modelStatus[chat.model];
  const modelReady = ms?.status === 'ready';
  const isStreaming = chat.phase !== 'idle';
  const canSend = modelReady && input.trim().length > 0 && !isStreaming;

  const usage = ctxInfo
    ? contextUsage({ messages: chat.messages, refs: chat.refs, draft: input, capChars: ctxInfo.promptCapChars })
    : null;
  const ctxTooltip = usage && ctxInfo ? contextTooltip(usage, ctxInfo.estimated, ctxInfo.nCtx) : '';

  return (
    <div className="chat-view">
      <div className="chat-messages" ref={msgRef} onMouseUp={handleMsgMouseUp} onMouseDown={() => setReplyAt(null)}>
        {chat.messages.map((msg, i) => (
          <div key={i} className={`msg ${msg.role}`}>
            <div className="msg-bubble">
              {msg.stopped && <span className="stopped-label">stopped</span>}
              <span className="msg-content">{msg.content}</span>
            </div>
            {msg.role === 'assistant' && (
              <button
                className="icon-btn msg-actions"
                aria-label="Insert below cursor"
                aria-disabled={!isEdit || undefined}
                title={!isEdit ? 'Switch to Edit view to insert' : undefined}
                onClick={() => {
                  if (isEdit) insertFromChat(msg.content);
                }}
              >
                <ClipboardPaste size={14} />
              </button>
            )}
          </div>
        ))}

        {chat.messages.length === 0 && !isStreaming && (
          <div className="chat-empty">
            <p>Ask about your lesson, or pick a skill.</p>
            <div className="chat-empty-chips">
              <button className="chip-btn" onClick={() => handlePick('/ccq')}>/ccq</button>
              <button className="chip-btn" onClick={() => handlePick('/drills')}>/drills</button>
              <button className="chip-btn" onClick={() => handlePick('/pitfalls')}>/pitfalls</button>
            </div>
          </div>
        )}
        {chat.phase === 'swapping' && (
          <div className="msg assistant">
            <span className="phase-line">Loading model…</span>
          </div>
        )}
        {chat.phase === 'generating' && (
          <div className="msg assistant">
            <span className="phase-line">Writing…</span>
          </div>
        )}
        {replyAt && (
          <button
            type="button"
            className="icon-btn chat-reply-btn"
            aria-label="Reply"
            title="Reply"
            style={{ top: replyAt.top, left: replyAt.left }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={() => {
              replyWithSelection(replyAt.text);
              setReplyAt(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <CornerUpLeft size={14} />
          </button>
        )}
      </div>

      {chat.refs.length > 0 && (
        <div className="chips">
          {chat.refs.map((ref) => (
            <span key={ref.name} className="chip">
              {ref.name}
              <button
                className="icon-btn"
                aria-label={`Remove ${ref.name}`}
                onClick={() => removeRef(activeId, ref.name)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {slashOpen && (
        <SlashList
          query={slashQuery ?? ''}
          skills={skills}
          activeIndex={safeActiveIndex}
          onPick={handlePick}
          disabled={!isEdit}
        />
      )}

      {usage?.warn && (
        <div className="ctx-warning" role="status">Context almost full. Remove an attachment or start a new chat.</div>
      )}
      <div className="edit-bar">
        <button
          className={`icon-btn edit-toggle${entry?.on ? ' active' : ''}`}
          aria-label="Edit mode"
          aria-pressed={entry?.on ?? false}
          aria-disabled={!isEdit || undefined}
          title={!isEdit ? 'Switch to Edit view to edit' : undefined}
          onClick={() => {
            if (!isEdit) return;
            useEditEntry.getState().setOn(activeId, !(entry?.on));
          }}
        >
          <Pencil size={14} />
        </button>
        {entry?.on && isEdit && (
          <>
            <button
              className="chip-btn"
              aria-label="Edit scope"
              title={scope === 'selection' && !hasSel ? 'Select text in the lesson first' : undefined}
              onClick={() => {
                const next = scope === 'selection' ? 'section' : scope === 'section' ? 'lesson' : 'selection';
                useEditEntry.getState().setScope(activeId, next);
              }}
            >
              {scope === 'selection' ? 'Selection' : scope === 'section' ? 'This section' : 'Whole lesson'}
            </button>
            <button
              className="icon-btn"
              aria-label="Lock scope"
              aria-pressed={entry.lock}
              title="Keep this scope after each request"
              onClick={() => {
                useEditEntry.getState().setLock(activeId, !entry.lock);
              }}
            >
              {entry.lock ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <button
              className={`icon-btn${allowProtected ? ' active' : ''}`}
              aria-label="Allow changes to notes and answers"
              aria-pressed={allowProtected}
              title="Allow changes to notes and answers"
              onClick={() => {
                useEditEntry.getState().setAllowProtected(!allowProtected);
              }}
            >
              <ShieldAlert size={14} />
            </button>
          </>
        )}
      </div>
      <div className="chat-input">
        <button
          className="icon-btn chat-attach"
          aria-label="Attach file"
          onClick={() => fileRef.current?.click()}
        >
          <Plus size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.csv,.pdf,.docx"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <textarea
          ref={inputRef}
          aria-label="Message"
          value={input}
          placeholder={entry?.on && isEdit ? 'Describe the change to make' : undefined}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <div className="chat-send">
          {isStreaming ? (
            <button className="icon-btn" aria-label="Stop" onClick={() => stop(activeId)}>
              <Square size={16} />
            </button>
          ) : (
            <button
              className="icon-btn"
              aria-label="Send"
              disabled={!canSend}
              onClick={doSend}
            >
              <Send size={16} />
            </button>
          )}
          {usage && <ContextRing usage={usage} tooltip={ctxTooltip} />}
        </div>
      </div>
    </div>
  );
}
