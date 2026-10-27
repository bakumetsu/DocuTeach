import { useEffect } from 'react';
import { Loader2, Eraser } from 'lucide-react';
import { useChats } from './chatStore';
import { ChatTabs } from './ChatTabs';
import { ChatView } from './ChatView';
import { SkillsTab } from './SkillsTab';

export function AssistantPane() {
  const models = useChats((s) => s.models);
  const modelStatus = useChats((s) => s.modelStatus);
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const selectModel = useChats((s) => s.selectModel);
  const retryModel = useChats((s) => s.retryModel);
  const flushCache = useChats((s) => s.flushCache);
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
      {/* Header strip */}
      <div className="assistant-header">
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
      </div>

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
