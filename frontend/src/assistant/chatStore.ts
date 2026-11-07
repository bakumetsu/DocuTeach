import { create } from 'zustand';
import { api } from '../api';
import type { ModelInfo, ModelState, SkillInfo, ChatMessage, ChatRequest, ChatRecord } from '../api/types';
import { runPageSkill, runPageEdit } from './pageBridge';
import { getChatEdit, effectiveScope, useEditEntry } from './editEntry';
import { useApp } from '../state/store';
import { noteStreamError, clearAiNotice } from './aiNotice';

export interface Chat {
  id: string;
  name: string;
  model: string;
  messages: ChatMessage[];
  refs: { name: string; text: string }[];
  phase: 'idle' | 'swapping' | 'generating';
}

interface ChatState {
  chats: Chat[];
  activeId: string;
  models: ModelInfo[];
  modelStatus: Record<string, ModelState>;
  skills: SkillInfo[];
  paneTab: 'assistant' | 'skills';
  inputs: Record<string, string>;
  focusNonce: number;
  closed: { chat: Chat; index: number; replacedByFresh: boolean } | null;
  ready: boolean;

  init: () => Promise<void>;
  newChat: () => void;
  closeChat: (id: string) => void;
  undoClose: () => void;
  switchChat: (id: string) => void;
  selectModel: (chatId: string, modelId: string) => Promise<void>;
  retryModel: (chatId: string) => void;
  unloadModel: (chatId: string) => Promise<void>;
  reloadModel: (chatId: string) => Promise<void>;
  refreshModels: () => Promise<void>;
  setInput: (chatId: string, text: string) => void;
  quoteIntoInput: (text: string) => void;
  setPaneTab: (tab: 'assistant' | 'skills') => void;
  attachText: (chatId: string, name: string, text: string) => void;
  removeRef: (chatId: string, name: string) => void;
  send: (chatId: string, text: string, opts?: { selection?: string }) => Promise<void>;
  stop: (chatId: string) => void;
  flushCache: (chatId: string) => void;
  persist: () => void;
  abortAll: () => void;
}

// ── module-level state ──────────────────────────────────────────────
let idCounter = 0;
function genId(): string {
  return `chat-${++idCounter}`;
}

const controllers = new Map<string, AbortController>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let closedTimer: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<void> | null = null;

// ── skill matching ──────────────────────────────────────────────────
function matchSkill(text: string, skills: SkillInfo[]): { skill: string; rest: string } | null {
  if (!text.startsWith('/')) return null;
  const spaceIdx = text.indexOf(' ');
  const cmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1);
  const skill = skills.find((s) => s.command === cmd && s.status === 'active');
  if (!skill) return null;
  return { skill: cmd, rest };
}

// ── store ───────────────────────────────────────────────────────────
export const useChats = create<ChatState>()((set, get) => {
  // Map current chats to the persisted shape
  function toRecords(): ChatRecord[] {
    return get().chats.map((c) => ({
      id: c.id,
      name: c.name,
      model: c.model,
      messages: c.messages,
      refs: c.refs,
    }));
  }

  // Debounced persist helper (module-level timer)
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    const lessonId = useApp.getState().lessonId;
    persistTimer = setTimeout(() => {
      void api.chats.save(lessonId, toRecords());
    }, 400);
  }

  function abortChat(chatId: string) {
    const ctrl = controllers.get(chatId);
    if (ctrl) {
      ctrl.abort();
      controllers.delete(chatId);
    }
  }

  /**
   * Cancel a running reply: abort the stream, release the chat slot,
   * mark the last assistant message `stopped: true`, and reset phase
   * to 'idle'.
   */
  function cancelRunning(chatId: string) {
    abortChat(chatId);
    void api.chats.release(chatId);
    set((s) => ({
      chats: s.chats.map((c) => {
        if (c.id !== chatId) return c;
        const msgs = c.messages.map((m, i) =>
          i === c.messages.length - 1 && m.role === 'assistant'
            ? { ...m, stopped: true }
            : m,
        );
        return { ...c, phase: 'idle' as const, messages: msgs };
      }),
    }));
  }

  return {
    chats: [],
    activeId: '',
    models: [],
    modelStatus: {},
    skills: [],
    paneTab: 'assistant',
    inputs: {},
    focusNonce: 0,
    closed: null,
    ready: false,

    async init() {
      if (initPromise) return initPromise;

      initPromise = (async () => {
        const [modelsR, skillsR, storedR, currentR] = await Promise.allSettled([
          api.models.list(),
          api.skills.list(),
          api.chats.load(useApp.getState().lessonId),
          api.models.current(),
        ]);
        const models = modelsR.status === 'fulfilled' ? modelsR.value : ([] as ModelInfo[]);
        const skills = skillsR.status === 'fulfilled' ? skillsR.value : ([] as SkillInfo[]);
        const storedChats = storedR.status === 'fulfilled' ? storedR.value : ([] as ChatRecord[]);
        let currentModel: string | null | undefined =
          currentR.status === 'fulfilled' ? currentR.value : undefined;
        if (!currentModel) currentModel = models[0]?.id ?? '';

        let chats: Chat[];
        if (storedChats.length > 0) {
          chats = storedChats.map((r) => ({
            id: r.id,
            name: r.name,
            model: r.model,
            messages: r.messages,
            refs: r.refs,
            phase: 'idle' as const,
          }));
        } else {
          chats = [
            {
              id: genId(),
              name: 'Chat 1',
              model: currentModel,
              messages: [],
              refs: [],
              phase: 'idle',
            },
          ];
        }

        set({
          models,
          skills,
          chats,
          activeId: chats[0].id,
          ready: true,
        });

        if (currentModel) {
          try {
            await get().selectModel(chats[0].id, currentModel);
          } catch {
            set((s) => ({
              modelStatus: {
                ...s.modelStatus,
                [currentModel]: { id: currentModel, status: 'failed', error: 'AI offline' },
              },
            }));
          }
        }
      })();

      return initPromise;
    },

    newChat() {
      const { chats, activeId } = get();
      const activeChat = chats.find((c) => c.id === activeId);

      // Cancel running reply of the previously active chat
      if (activeChat && (activeChat.phase === 'swapping' || activeChat.phase === 'generating')) {
        cancelRunning(activeId);
      }

      const n = chats.length + 1;
      const chat: Chat = {
        id: genId(),
        name: `Chat ${n}`,
        model: activeChat?.model ?? get().models[0]?.id ?? '',
        messages: [],
        refs: [],
        phase: 'idle',
      };
      set((s) => ({
        chats: [...s.chats, chat],
        activeId: chat.id,
      }));
      schedulePersist();
    },

    closeChat(id) {
      const { chats } = get();
      const index = chats.findIndex((c) => c.id === id);
      if (index === -1) return;

      const chat = chats[index];
      const remaining = chats.filter((c) => c.id !== id);

      // Cancel running reply (abort + release + mark stopped + idle)
      if (chat.phase === 'swapping' || chat.phase === 'generating') {
        cancelRunning(id);
      } else {
        void api.chats.release(id);
      }

      // Auto-clear closed after 10 s
      if (closedTimer) clearTimeout(closedTimer);
      closedTimer = setTimeout(() => {
        set({ closed: null });
      }, 10_000);

      set((s) => ({
        chats: remaining,
        activeId:
          s.activeId === id ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? '') : s.activeId,
        closed: { chat, index, replacedByFresh: false },
      }));
      schedulePersist();
    },

    undoClose() {
      const { closed, chats } = get();
      if (!closed) return;

      if (closedTimer) {
        clearTimeout(closedTimer);
        closedTimer = null;
      }

      const restored: Chat = { ...closed.chat, phase: 'idle' };
      let newChats: Chat[];

      if (
        closed.replacedByFresh &&
        closed.index === 0 &&
        chats.length === 1 &&
        chats[0].messages.length === 0
      ) {
        newChats = [restored];
      } else {
        const idx = Math.min(closed.index, chats.length);
        newChats = [...chats];
        newChats.splice(idx, 0, restored);
      }

      set({
        chats: newChats,
        activeId: restored.id,
        closed: null,
      });
      schedulePersist();
    },

    switchChat(id) {
      const { activeId, chats } = get();
      if (id === activeId) return;

      // Cancel running reply of the chat being left
      const leaving = chats.find((c) => c.id === activeId);
      if (leaving && (leaving.phase === 'swapping' || leaving.phase === 'generating')) {
        cancelRunning(activeId);
      }

      set({ activeId: id });
    },

    async selectModel(chatId, modelId) {
      set((s) => ({
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, model: modelId } : c)),
        modelStatus: {
          ...s.modelStatus,
          [modelId]: { id: modelId, status: 'loading' },
        },
      }));

      const state = await api.models.select(modelId);
      set((s) => ({
        modelStatus: { ...s.modelStatus, [modelId]: state },
      }));
    },

    retryModel(chatId) {
      const chat = get().chats.find((c) => c.id === chatId);
      if (!chat) return;
      void get().selectModel(chatId, chat.model);
    },

    async unloadModel(chatId) {
      const chat = get().chats.find((c) => c.id === chatId);
      if (!chat) return;
      if (chat.phase !== 'idle') get().stop(chatId);
      const id = chat.model;
      await api.models.unload(id);
      set((s) => ({ modelStatus: { ...s.modelStatus, [id]: { id, status: 'unloaded' } } }));
    },

    async reloadModel(chatId) {
      const chat = get().chats.find((c) => c.id === chatId);
      if (!chat) return;
      if (chat.phase !== 'idle') get().stop(chatId);
      await get().unloadModel(chatId);
      await get().selectModel(chatId, chat.model);
    },

    async refreshModels() {
      const [modelsR, currentR] = await Promise.allSettled([api.models.list(), api.models.current()]);
      if (modelsR.status !== 'fulfilled' || modelsR.value.length === 0) return;
      const models = modelsR.value;
      const current = (currentR.status === 'fulfilled' && currentR.value) || models[0].id;
      set({ models });
      const { chats, activeId } = get();
      const chat = chats.find((c) => c.id === activeId);
      if (!chat) return;
      const target = chat.model && models.some((m) => m.id === chat.model) ? chat.model : current;
      await get().selectModel(chat.id, target);
    },

    setInput(chatId, text) {
      set((s) => ({ inputs: { ...s.inputs, [chatId]: text } }));
    },

    quoteIntoInput(text) {
      const quoted = text
        .trim()
        .split(/\r?\n/)
        .map((l) => (l.trim() ? `> ${l}` : '>'))
        .join('\n');
      if (!quoted.replace(/[>\s]/g, '')) return;
      const { activeId, inputs } = get();
      const base = (inputs[activeId] ?? '').trimEnd();
      set((s) => ({
        inputs: { ...s.inputs, [activeId]: (base ? base + '\n\n' : '') + quoted + '\n\n' },
        paneTab: 'assistant',
        focusNonce: s.focusNonce + 1,
      }));
    },

    setPaneTab(tab) {
      set({ paneTab: tab });
    },

    attachText(chatId, name, text) {
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, refs: [...c.refs, { name, text }] } : c,
        ),
      }));
      schedulePersist();
    },

    removeRef(chatId, name) {
      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, refs: c.refs.filter((r) => r.name !== name) } : c,
        ),
      }));
      schedulePersist();
    },

    async send(chatId, text, opts) {
      const { chats, modelStatus, skills } = get();
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return;

      // Refuse if model not ready
      const ms = modelStatus[chat.model];
      if (!ms || (ms.status !== 'ready' && ms.status !== 'unloaded')) return;

      // Refuse if already streaming
      if (chat.phase === 'swapping' || chat.phase === 'generating') return;

      // Reload a model the user unloaded
      if (ms.status === 'unloaded') {
        await get().selectModel(chatId, chat.model);
        if (get().modelStatus[chat.model]?.status !== 'ready') return;
      }

      // ── Edit command path ──
      const editState = getChatEdit(chatId);
      const isEditCmd = text.startsWith('/edit ');
      if (text.trim() === '/edit') return;
      if (editState.on || isEditCmd) {
        const instruction = isEditCmd ? text.slice(6).trim() : text;
        if (!instruction) return;
        let noteAdded = false;
        let pendingReply = '';
        const appendReply = (reply: string) => {
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? { ...c, messages: [...c.messages, { role: 'assistant', content: reply }] }
                : c,
            ),
          }));
          schedulePersist();
        };
        const handled = runPageEdit({
          instruction,
          scope: effectiveScope(chatId),
          allowProtected: useEditEntry.getState().allowProtected,
          onReply: (reply) => {
            if (!reply) return;
            if (!noteAdded) pendingReply = reply;
            else appendReply(reply);
          },
        });
        const userMsg: ChatMessage = { role: 'user', content: text };
        const note: ChatMessage = {
          role: 'assistant',
          content: handled ? 'Suggestions sent to the lesson' : 'The page is not available for edits',
        };
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, messages: [...c.messages, userMsg, note] } : c,
          ),
        }));
        schedulePersist();
        noteAdded = true;
        if (pendingReply) appendReply(pendingReply);
        if (handled) {
          useEditEntry.getState().afterRun(chatId);
        }
        return;
      }

      // ── Skill command path ──
      const skillMatch = matchSkill(text, skills);
      if (skillMatch) {
        const handled = runPageSkill({
          skill: skillMatch.skill,
          selection: opts?.selection,
          prompt: skillMatch.rest,
          chatId,
        });

        const userMsg: ChatMessage = { role: 'user', content: text };
        const note: ChatMessage = {
          role: 'assistant',
          content: handled ? 'Draft sent to the page' : 'The page is not available for drafts',
        };

        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, messages: [...c.messages, userMsg, note] } : c,
          ),
        }));
        schedulePersist();
        return;
      }

      // ── Plain question path ──
      const userMsg: ChatMessage = { role: 'user', content: text };
      const assistantMsg: ChatMessage = { role: 'assistant', content: '' };

      const controller = new AbortController();
      controllers.set(chatId, controller);

      // Messages for the request: existing + new user (no empty assistant placeholder)
      const reqMessages: ChatMessage[] = [...chat.messages, userMsg];

      set((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId
            ? { ...c, messages: [...c.messages, userMsg, assistantMsg], phase: 'swapping' as const }
            : c,
        ),
      }));

      const req: ChatRequest = {
        chatId,
        model: chat.model,
        messages: reqMessages,
        selection: opts?.selection,
        refs: chat.refs,
      };

      let errored = false;
      try {
        for await (const ev of api.chat.stream(req, controller.signal)) {
          if (controller.signal.aborted) break;

          switch (ev.type) {
            case 'status':
              set((s) => ({
                chats: s.chats.map((c) =>
                  c.id === chatId ? { ...c, phase: ev.status === 'thinking' ? 'generating' : ev.status } : c,
                ),
              }));
              break;
            case 'token':
              clearAiNotice();
              set((s) => ({
                chats: s.chats.map((c) => {
                  if (c.id !== chatId) return c;
                  const msgs = [...c.messages];
                  const last = msgs.length - 1;
                  msgs[last] = { ...msgs[last], content: msgs[last].content + ev.text };
                  return { ...c, messages: msgs };
                }),
              }));
              break;
            case 'error':
              noteStreamError(ev.code);
              set((s) => ({
                chats: s.chats.map((c) => {
                  if (c.id !== chatId) return c;
                  const msgs = [...c.messages];
                  const last = msgs.length - 1;
                  msgs[last] = {
                    ...msgs[last],
                    content: msgs[last].content + '\n\u26A0 ' + ev.message,
                  };
                  return { ...c, messages: msgs };
                }),
              }));
              errored = true;
              break;
            case 'stats':
              set((s) => ({
                chats: s.chats.map((c) => {
                  if (c.id !== chatId) return c;
                  if (c.messages.length === 0) return c;
                  const msgs = [...c.messages];
                  const last = msgs.length - 1;
                  msgs[last] = { ...msgs[last], stats: { in: ev.in, out: ev.out, tps: ev.tps } };
                  return { ...c, messages: msgs };
                }),
              }));
              break;
            case 'structured':
              // ignored for chat
              break;
            case 'done':
              clearAiNotice();
              break;
          }
          if (errored) break;
        }
      } catch {
        // abort or unexpected error – handled below
      }

      // Finalise only if this request is still the active one for the chat.
      // If stop/cancelRunning already handled it, or a new send replaced it,
      // do not overwrite the newer state.
      if (controllers.get(chatId) === controller) {
        if (controller.signal.aborted) {
          set((s) => ({
            chats: s.chats.map((c) => {
              if (c.id !== chatId) return c;
              const msgs = c.messages.map((m, i) =>
                i === c.messages.length - 1 && m.role === 'assistant'
                  ? { ...m, stopped: true }
                  : m,
              );
              return { ...c, phase: 'idle' as const, messages: msgs };
            }),
          }));
        } else {
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId ? { ...c, phase: 'idle' as const } : c,
            ),
          }));
        }
        controllers.delete(chatId);
      }

      schedulePersist();
    },

    stop(chatId) {
      cancelRunning(chatId);
    },

    flushCache(chatId) {
      void api.chats.release(chatId);
    },

    persist() {
      schedulePersist();
    },

    abortAll() {
      const lessonId = useApp.getState().lessonId;
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        void api.chats.save(lessonId, toRecords());
      }
      for (const [id, ctrl] of controllers) {
        ctrl.abort();
        controllers.delete(id);
        void api.chats.release(id);
      }
      set((s) => ({
        chats: s.chats.map((c) => ({ ...c, phase: 'idle' as const })),
      }));
    },
  };
});

// ── test helper ─────────────────────────────────────────────────────
export function resetChatsForTest(): void {
  idCounter = 0;
  initPromise = null;
  controllers.clear();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (closedTimer) {
    clearTimeout(closedTimer);
    closedTimer = null;
  }
  useChats.setState({
    chats: [],
    activeId: '',
    models: [],
    modelStatus: {},
    skills: [],
    paneTab: 'assistant',
    inputs: {},
    closed: null,
    ready: false,
  });
}
