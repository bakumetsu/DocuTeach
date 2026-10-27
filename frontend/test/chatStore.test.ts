import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChats, resetChatsForTest } from '../src/assistant/chatStore';
import { api } from '../src/api';
import { mockConfig } from '../src/api/mock/config';

// Mock pageBridge
vi.mock('../src/assistant/pageBridge', () => ({
  runPageSkill: vi.fn(() => false),
  insertFromChat: vi.fn(() => false),
  setPageHandlers: vi.fn(),
}));

import { runPageSkill } from '../src/assistant/pageBridge';

// Capture originals before any test mutates them
const originalConfig = { ...mockConfig };

beforeEach(() => {
  mockConfig.swapMs = 0;
  mockConfig.loadMs = 0;
  mockConfig.tokenMinMs = 0;
  mockConfig.tokenMaxMs = 1;
  localStorage.clear();
  resetChatsForTest();
  vi.clearAllMocks();
});

afterEach(() => {
  mockConfig.swapMs = originalConfig.swapMs;
  mockConfig.loadMs = originalConfig.loadMs;
  mockConfig.tokenMinMs = originalConfig.tokenMinMs;
  mockConfig.tokenMaxMs = originalConfig.tokenMaxMs;
});

describe('chatStore', () => {
  it('init creates one chat, loads 3 models and 6 skills, default model becomes ready', async () => {
    await useChats.getState().init();
    const s = useChats.getState();

    expect(s.ready).toBe(true);
    expect(s.chats).toHaveLength(1);
    expect(s.models).toHaveLength(3);
    expect(s.skills).toHaveLength(6);

    const modelId = s.chats[0].model;
    expect(s.modelStatus[modelId]?.status).toBe('ready');
  });

  it('send a plain question produces user + assistant message with scripted reply, phase idle', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    await useChats.getState().send(chatId, 'What is gravity?');

    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages[0].role).toBe('user');
    expect(chat.messages[0].content).toBe('What is gravity?');
    expect(chat.messages[1].role).toBe('assistant');
    expect(chat.messages[1].content).toContain('scripted reply');
    expect(chat.phase).toBe('idle');
  });

  it('sending a message containing [fail] ends with an assistant message containing \u26A0', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    await useChats.getState().send(chatId, 'please [fail]');

    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    const last = chat.messages[chat.messages.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toContain('\u26A0');
    expect(chat.phase).toBe('idle');
  });

  it('switching to another chat mid-stream marks the running reply stopped', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    // Create the second chat BEFORE sending
    useChats.getState().newChat();
    const secondId = useChats.getState().activeId;

    // Switch back to the first chat so it is active when we send
    useChats.getState().switchChat(chatId);

    // Start send without awaiting
    const sendPromise = useChats.getState().send(chatId, 'long question');

    // Wait until the assistant message has some content (first token arrived)
    await vi.waitFor(() => {
      const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
      const last = chat.messages[chat.messages.length - 1];
      expect(last.content.length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    // Switch away – should cancel the running reply
    useChats.getState().switchChat(secondId);

    await sendPromise;

    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    const last = chat.messages[chat.messages.length - 1];
    expect(last.stopped).toBe(true);
    expect(chat.phase).toBe('idle');
  });

  it('newChat while a reply is running marks the reply stopped', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    // Start send without awaiting
    const sendPromise = useChats.getState().send(chatId, 'long question');

    // Wait until the assistant message has some content (first token arrived)
    await vi.waitFor(() => {
      const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
      const last = chat.messages[chat.messages.length - 1];
      expect(last.content.length).toBeGreaterThan(0);
    }, { timeout: 2000 });

    // Create a new chat – should cancel the running reply in the old active chat
    useChats.getState().newChat();

    await sendPromise;

    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    const last = chat.messages[chat.messages.length - 1];
    expect(last.stopped).toBe(true);
    expect(chat.phase).toBe('idle');
  });

  it('selectModel to broken-model yields failed status; send is refused', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    await useChats.getState().selectModel(chatId, 'broken-model');
    const s = useChats.getState();
    expect(s.modelStatus['broken-model'].status).toBe('failed');
    expect(s.modelStatus['broken-model'].error).toBe('Could not load');

    const msgCountBefore = s.chats.find((c) => c.id === chatId)!.messages.length;
    await useChats.getState().send(chatId, 'hello');
    const msgCountAfter = useChats.getState().chats.find((c) => c.id === chatId)!.messages.length;
    expect(msgCountAfter).toBe(msgCountBefore);
  });

  it('selectModel back to qwen-27b yields ready', async () => {
    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    await useChats.getState().selectModel(chatId, 'qwen-27b');
    expect(useChats.getState().modelStatus['qwen-27b'].status).toBe('ready');
  });

  it('/ccq with runPageSkill returning true adds user line and note, does NOT call api.chat.stream', async () => {
    vi.mocked(runPageSkill).mockReturnValue(true);
    const streamSpy = vi.spyOn(api.chat, 'stream');

    await useChats.getState().init();
    const chatId = useChats.getState().activeId;

    await useChats.getState().send(chatId, '/ccq explain this');

    const chat = useChats.getState().chats.find((c) => c.id === chatId)!;
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages[0].content).toBe('/ccq explain this');
    expect(chat.messages[1].content).toBe('Draft sent to the page');
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('closeChat then undoClose restores the chat at the same index', async () => {
    await useChats.getState().init();
    useChats.getState().newChat();
    useChats.getState().newChat();

    const { chats } = useChats.getState();
    expect(chats).toHaveLength(3);
    const target = chats[1];
    const targetIndex = 1;

    useChats.getState().closeChat(target.id);
    expect(useChats.getState().chats).toHaveLength(2);
    expect(useChats.getState().closed).not.toBeNull();

    useChats.getState().undoClose();
    const after = useChats.getState().chats;
    expect(after).toHaveLength(3);
    expect(after[targetIndex].id).toBe(target.id);
    expect(useChats.getState().closed).toBeNull();
  });

  it('closing the last chat creates a fresh one', async () => {
    await useChats.getState().init();
    const { chats } = useChats.getState();
    expect(chats).toHaveLength(1);

    useChats.getState().closeChat(chats[0].id);
    const after = useChats.getState().chats;
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(chats[0].id);
  });

  it('chats persist: after persist flush, load returns chats and new init restores them', async () => {
    vi.useFakeTimers();

    // init with fake timers – need to let promises resolve
    // Since mockConfig delays are 0/1 ms, we advance time
    const initPromise = useChats.getState().init();
    await vi.advanceTimersByTimeAsync(100);
    await initPromise;

    // Send a message so we have content
    const chatId = useChats.getState().activeId;
    const sendPromise = useChats.getState().send(chatId, 'persist test');
    await vi.advanceTimersByTimeAsync(100);
    await sendPromise;

    // Flush the debounced persist
    await vi.advanceTimersByTimeAsync(500);

    // Verify load returns the chats
    const loaded = await api.chats.load('draft');
    expect(loaded.length).toBeGreaterThanOrEqual(1);
    expect(loaded[0].messages.length).toBeGreaterThanOrEqual(2);

    // Reset and re-init
    resetChatsForTest();
    const init2Promise = useChats.getState().init();
    await vi.advanceTimersByTimeAsync(100);
    await init2Promise;

    const restored = useChats.getState().chats;
    expect(restored).toHaveLength(loaded.length);
    expect(restored[0].messages).toEqual(loaded[0].messages);

    vi.useRealTimers();
  });
});
