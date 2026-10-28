import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { api } from '../api';
import { useChats } from '../assistant/chatStore';
import { useApp } from '../state/store';
import { insertFragment } from './insert';

export interface SlotState {
  id: string;
  pos: number;
  text: string;
  done: boolean;
}

export const slotKey = new PluginKey<SlotState | null>('streamSlot');

type SlotMeta =
  | { type: 'start'; id: string; pos: number }
  | { type: 'append'; text: string }
  | { type: 'done' }
  | { type: 'clear' };

let running: { controller: AbortController; id: string } | null = null;

export function getSlot(editor: Editor): SlotState | null {
  return slotKey.getState(editor.state) ?? null;
}

export function isStreaming(): boolean {
  return running !== null;
}

function buildCard(slot: SlotState, editor: Editor): HTMLElement {
  const card = document.createElement('div');
  card.className = 'incoming-card';
  card.contentEditable = 'false';
  card.tabIndex = 0;
  card.setAttribute('role', 'status');

  const header = document.createElement('div');
  header.className = 'incoming-header';

  const label = document.createElement('span');
  label.className = 'incoming-label';
  label.textContent = 'Draft (not added yet)';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'incoming-cancel';
  cancelBtn.textContent = '\u2715';
  cancelBtn.setAttribute('aria-label', 'Discard draft');
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    cancelPageStream(editor);
  });

  header.appendChild(label);
  header.appendChild(cancelBtn);

  const textEl = document.createElement('div');
  textEl.className = 'incoming-text';
  textEl.textContent = slot.text || 'Drafting\u2026';

  const hint = document.createElement('span');
  hint.className = 'incoming-hint';
  hint.textContent = 'Esc to discard';

  card.appendChild(header);
  card.appendChild(textEl);
  card.appendChild(hint);

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelPageStream(editor);
    }
  });

  return card;
}

export const StreamSlot = Extension.create({
  name: 'streamSlot',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: slotKey,
        state: {
          init: (): SlotState | null => null,
          apply: (tr, value: SlotState | null): SlotState | null => {
            const meta = tr.getMeta(slotKey) as SlotMeta | undefined;
            if (meta) {
              switch (meta.type) {
                case 'start':
                  return { id: meta.id, pos: meta.pos, text: '', done: false };
                case 'append':
                  if (!value) return value;
                  return { ...value, text: value.text + meta.text };
                case 'done':
                  if (!value) return value;
                  return { ...value, done: true };
                case 'clear':
                  return null;
              }
            }
            if (value && tr.docChanged) {
              return { ...value, pos: tr.mapping.map(value.pos, -1) };
            }
            return value;
          },
        },
        props: {
          decorations: (state) => {
            const slot = slotKey.getState(state);
            if (!slot) return DecorationSet.empty;
            const pos = Math.min(slot.pos, state.doc.content.size);
            const dom = buildCard(slot, editor);
            const widget = Decoration.widget(pos, dom, {
              side: 1,
              key: 'incoming-' + slot.id,
            });
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Escape: () => cancelPageStream(this.editor),
    };
  },
});

export function startPageStream(
  editor: Editor,
  opts: { skill: string; selection?: string; prompt?: string },
): boolean {
  if (running) {
    useApp.getState().showToast('Wait for the current draft or press Esc');
    return false;
  }

  const { activeId, chats, modelStatus } = useChats.getState();
  const activeChat = chats.find((c) => c.id === activeId);
  if (!activeChat) {
    useApp.getState().showToast('Pick a ready model first');
    return false;
  }
  const model = activeChat.model;
  if (modelStatus[model]?.status !== 'ready') {
    useApp.getState().showToast('Pick a ready model first');
    return false;
  }

  // Anchor: end of the top-level block containing the selection END
  const $to = editor.state.selection.$to;
  const anchorPos =
    $to.depth === 0 ? editor.state.doc.content.size : $to.after(1);

  const id = crypto.randomUUID();

  // Dispatch slot start (no history)
  editor.view.dispatch(
    editor.state.tr.setMeta(slotKey, { type: 'start', id, pos: anchorPos }).scrollIntoView(),
  );

  const controller = new AbortController();
  running = { controller, id };

  // Run the stream loop asynchronously
  void (async () => {
    let accumulated = '';
    let structuredMarkdown: string | null = null;

    try {
      const stream = api.chat.stream(
        {
          chatId: 'page',
          model,
          skill: opts.skill,
          messages: [{ role: 'user', content: opts.prompt || opts.skill }],
          selection: opts.selection,
        },
        controller.signal,
      );

      for await (const event of stream) {
        if (controller.signal.aborted) break;

        switch (event.type) {
          case 'token':
            accumulated += event.text;
            editor.view.dispatch(
              editor.state.tr.setMeta(slotKey, { type: 'append', text: event.text }),
            );
            break;
          case 'structured':
            structuredMarkdown = event.markdown;
            break;
          case 'error':
            editor.view.dispatch(
              editor.state.tr.setMeta(slotKey, { type: 'clear' }),
            );
            useApp.getState().showToast(event.message || 'Stream error');
            return;
          case 'done':
            break;
        }
      }
    } catch {
      // Network or iteration error – clear and toast
      if (!controller.signal.aborted) {
        editor.view.dispatch(
          editor.state.tr.setMeta(slotKey, { type: 'clear' }),
        );
        useApp.getState().showToast('Stream failed');
      }
      return;
    } finally {
      // Only the stream that is still current cleans up. A cancelled stream was
      // already released by cancelPageStream, and a restart may own `running` now.
      if (running?.id === id) {
        running = null;
        void api.chats.release('page');
      }
    }

    // Commit: only if not aborted
    if (controller.signal.aborted) return;

    try {
      const slot = getSlot(editor);
      const commitPos = slot ? slot.pos : anchorPos;
      insertFragment(
        editor,
        structuredMarkdown ?? accumulated,
        commitPos,
        { clearSlot: true },
      );
    } catch {
      useApp.getState().showToast('Could not add the draft');
      const tr = editor.state.tr.setMeta(slotKey, { type: 'clear' });
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    }
  })();

  return true;
}

export function cancelPageStream(editor: Editor): boolean {
  if (!running) return false;
  running.controller.abort();
  void api.chats.release('page');
  editor.view.dispatch(
    editor.state.tr.setMeta(slotKey, { type: 'clear' }),
  );
  running = null;
  return true;
}
