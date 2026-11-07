import { useChats } from './chatStore';

export function ChatTabs() {
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const switchChat = useChats((s) => s.switchChat);
  const closeChat = useChats((s) => s.closeChat);
  const newChat = useChats((s) => s.newChat);
  const closed = useChats((s) => s.closed);
  const undoClose = useChats((s) => s.undoClose);

  return (
    <div className="chat-tabs-area">
      {closed && (
        <div className="closed-bar" role="status">
          <span>Chat closed · </span>
          <button onClick={undoClose}>Undo</button>
        </div>
      )}
      <div className="chat-tabs" role="tablist" aria-label="Chats">
        {chats.map((chat) => (
          <div
            key={chat.id}
            role="tab"
            aria-selected={chat.id === activeId}
            className={`chat-tab${chat.id === activeId ? ' active' : ''}`}
            onClick={() => switchChat(chat.id)}
          >
            <span className="chat-tab-name">{chat.name}</span>
            <button
              className="icon-btn chat-tab-close"
              aria-label="Close chat"
              onClick={(e) => {
                e.stopPropagation();
                closeChat(chat.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="icon-btn chat-tab-new" aria-label="New chat" onClick={newChat}>
          +
        </button>
      </div>
    </div>
  );
}
