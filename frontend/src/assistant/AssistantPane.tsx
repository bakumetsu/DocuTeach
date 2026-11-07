import { useEffect, useState } from 'react';
import { Loader2, RotateCw, AlertTriangle, ChevronsRight, Power, Undo2 } from 'lucide-react';
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
  const newChat = useChats((s) => s.newChat);
  const retryModel = useChats((s) => s.retryModel);
  const reloadModel = useChats((s) => s.reloadModel);
  const refreshModels = useChats((s) => s.refreshModels);
  const unloadModel = useChats((s) => s.unloadModel);
  const [undo, setUndo] = useState(false);
  const paneTab = useChats((s) => s.paneTab);
  const setPaneTab = useChats((s) => s.setPaneTab);

  const chat = chats.find((c) => c.id === activeId);

  // Init once on mount
  useEffect(() => {
    void useChats.getState().init();
  }, []);

  const modelId = chat?.model ?? models[0]?.id ?? '';
  const ms = modelStatus[modelId];
  const ready = !!chat;

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
            value={modelId}
            disabled={!ready}
            onChange={(e) => void selectModel(activeId, e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={modelStatus[m.id]?.status === 'loading'}>
                {m.label}
              </option>
            ))}
          </select>

          <span className="model-slot">
            {ms?.status === 'loading' ? (
              <span className="spin" aria-label="Loading model">
                <Loader2 size={14} />
              </span>
            ) : ms?.status === 'failed' ? (
              <button
                className="icon-btn model-unloaded-icon"
                aria-label="Retry"
                title={ms.error ? `${ms.error}. Retry` : 'Retry'}
                onClick={() => retryModel(activeId)}
              >
                <AlertTriangle size={14} />
              </button>
            ) : undo && ms?.status === 'unloaded' ? (
              <button
                className="icon-btn"
                aria-label="Undo"
                title="Undo unload"
                onClick={() => {
                  setUndo(false);
                  void selectModel(activeId, modelId);
                }}
              >
                <Undo2 size={14} />
              </button>
            ) : null}
          </span>

          {ms?.status === 'unloaded' ? (
            <button
              className="icon-btn model-unloaded-icon"
              aria-label="Model unloaded. Reload"
              title="Model unloaded"
              onClick={() => void selectModel(activeId, modelId)}
            >
              <Power size={14} />
            </button>
          ) : (
            <button
              className="icon-btn"
              aria-label="Unload model"
              title="Unload model"
              disabled={!ready || ms?.status !== 'ready'}
              onClick={() => {
                if (chat && chat.phase !== 'idle' && !window.confirm('Stop the reply and unload the model?')) return;
                void unloadModel(activeId).then(() => setUndo(true));
              }}
            >
              <Power size={14} />
            </button>
          )}

          <button
            className="icon-btn"
            aria-label="Reload model"
            title="Reload model"
            disabled={!ready && models.length > 0}
            onClick={() => void (models.length === 0 ? refreshModels() : reloadModel(activeId))}
          >
            <RotateCw size={14} />
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
          {chat ? (
            <ChatView />
          ) : (
            <div className="chat-none">
              <p>No chats</p>
              <button className="retry-btn" onClick={newChat}>
                New chat
              </button>
            </div>
          )}
        </>
      ) : (
        <SkillsTab />
      )}
    </div>
  );
}
