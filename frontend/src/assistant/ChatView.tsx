import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Send, Square, Plus } from 'lucide-react';
import { useChats } from './chatStore';
import { useApp } from '../state/store';
import { insertFromChat } from './pageBridge';
import { SlashList } from './SlashList';

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

  const view = useApp((s) => s.view);
  const showToast = useApp((s) => s.showToast);

  const chat = chats.find((c) => c.id === activeId);

  const [activeIndex, setActiveIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);

  const msgRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const input = inputs[activeId] ?? '';
  const isEdit = view === 'edit';

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
      if (isSkill && !isEdit) {
        showToast('Page drafts work in Edit view');
        return;
      }
    }

    setInput(activeId, '');
    setSlashDismissed(true);
    void send(activeId, text);
  }, [input, activeId, isEdit, skills, showToast, setInput, send]);

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

  if (!chat) return null;

  const ms = modelStatus[chat.model];
  const modelReady = ms?.status === 'ready';
  const isStreaming = chat.phase !== 'idle';
  const canSend = modelReady && input.trim().length > 0 && !isStreaming;

  return (
    <div className="chat-view">
      <div className="chat-messages" ref={msgRef}>
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

      <div className="chat-input">
        <button
          className="icon-btn"
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
          aria-label="Message"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={2}
        />
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
      </div>
    </div>
  );
}
