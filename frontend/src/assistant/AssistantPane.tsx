import { useEffect, useState } from 'react';
import { Loader2, Eraser, ChevronsRight, Power, Undo2 } from 'lucide-react';
import { useChats } from './chatStore';
import { ChatTabs } from './ChatTabs';
import { ChatView } from './ChatView';
import { SkillsTab } from './SkillsTab';
import { OfflineNotice } from './OfflineNotice';

export function AssistantPane({ onCollapse }: { onCollapse: () => void }) {
  const models = useChats((s) => s.models);
  const modelStatus = useChats((s) => s.modelStatus);
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const selectModel = useChats((s) => s.selectModel);
  const retryModel = useChats((s) => s.retryModel);
  const flushCache = useChats((s) => s.flushCache);
  const unloadModel = useChats((s) => s.unloadModel);
  const [undo, setUndo] = useState(false);
  const paneTab = useChats((s) => s.paneTab);
  const setPaneTab = useChats((s) => s.setPaneTab);

  const chat = chats.find((c) => c.id === activeId);

  // Init once on mount
  useEffect(() => {
    void useChats.getState().init();
  }, []);

  if (!chat) return null;

  const ms = modelStatus[chat.model];

  return (
    <div className="assistant-body">
      <OfflineNotice />
      {/* Pane tabs */}
      <div className="pane-tabs" role="tablist" aria-label="Pane tabs">
        <button
          role="tab"
          aria-selected={paneTab === 'assistant'}
          className={`pane-tab${paneTab === 'assistant' ? ' active' : ''}`}
          onClick={() => setPaneTab('assistant')}
        >
          Assistant
        </button>
        <button
          role="tab"
          aria-selected={paneTab === 'skills'}
          className={`pane-tab${paneTab === 'skills' ? ' active' : ''}`}
          onClick={() => setPaneTab('skills')}
        >
          Skills
        </button>

        <span className="pane-tabs-end">
          <select
            className="model-select"
            aria-label="Model"
            value={chat.model}
            onChange={(e) => void selectModel(activeId, e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={modelStatus[m.id]?.status === 'loading'}>
                {m.label}
              </option>
            ))}
          </select>

          {ms?.status === 'unloaded' ? (
            <button
              className="icon-btn model-unloaded-icon"
              aria-label="Model unloaded. Reload"
              title="Model unloaded"
              onClick={() => void selectModel(activeId, chat.model)}
            >
              <Power size={14} />
            </button>
          ) : (
            <button
              className="icon-btn"
              aria-label="Unload model"
              title="Unload model"
              disabled={ms?.status !== 'ready'}
              onClick={() => {
                if (chat.phase !== 'idle' && !window.confirm('Stop the reply and unload the model?')) return;
                void unloadModel(activeId).then(() => setUndo(true));
              }}
            >
              <Power size={14} />
            </button>
          )}

          {undo && ms?.status === 'unloaded' && (
            <button
              className="icon-btn"
              aria-label="Undo"
              title="Undo unload"
              onClick={() => {
                setUndo(false);
                void selectModel(activeId, chat.model);
              }}
            >
              <Undo2 size={14} />
            </button>
          )}

          {ms?.status === 'loading' && (
            <span className="spin" aria-label="Loading model">
              <Loader2 size={14} />
            </span>
          )}

          {ms?.status === 'failed' && (
            <span className="model-error">
              <span>{ms.error}</span>
              <button className="retry-btn" onClick={() => retryModel(activeId)}>
                Retry
              </button>
            </span>
          )}

          <button
            className="icon-btn"
            aria-label="Flush cache"
            onClick={() => flushCache(activeId)}
          >
            <Eraser size={14} />
          </button>

          <button
            className="icon-btn"
            aria-label="Collapse assistant"
            onClick={onCollapse}
          >
            <ChevronsRight size={16} />
          </button>
        </span>
      </div>

      {/* Body */}
      {paneTab === 'assistant' ? (
        <>
          <ChatTabs />
          <ChatView />
        </>
      ) : (
        <SkillsTab />
      )}
    </div>
  );
}
