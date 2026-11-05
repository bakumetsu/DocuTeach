import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

// ---------- types ----------

export type ItemKind = 'replace' | 'insert' | 'delete' | 'move';
export type ItemStatus = 'pending' | 'stale';

export interface Item {
  opId: string;
  kind: ItemKind;
  from: number;
  to: number;
  anchorPos?: number;
  baseHash: string;
  markdown?: string;
  flags: string[];
  status: ItemStatus;
  requestId: string;
}

export interface SuggestState {
  requestId: string | null;
  requestText: string | null;
  items: Item[];
  focus: number | null;
  rejected: Item[];
  running: boolean;
  part: string | null;
}

const INITIAL: SuggestState = {
  requestId: null,
  requestText: null,
  items: [],
  focus: null,
  rejected: [],
  running: false,
  part: null,
};

// ---------- plugin key ----------

export const suggestKey = new PluginKey<SuggestState>('suggest');

// ---------- plugin ----------

const plugin = new Plugin({
  key: suggestKey,
  state: {
    init: () => INITIAL,
    apply: (tr, value, _oldState, _newState) => {
      const meta = tr.getMeta(suggestKey) as Record<string, unknown> | undefined;
      let state = value;

      if (meta) {
        switch (meta.type) {
          case 'start':
            state = { ...state, requestId: meta.requestId, requestText: meta.text };
            break;
          case 'add':
            state = { ...state, items: [...state.items, meta.item] };
            break;
          case 'remove':
            state = { ...state, items: state.items.filter((i) => !meta.opIds.includes(i.opId)) };
            break;
          case 'reject': {
            const toReject = new Set(meta.opIds);
            const moving = state.items.filter((i) => toReject.has(i.opId));
            state = {
              ...state,
              items: state.items.filter((i) => !toReject.has(i.opId)),
              rejected: [...state.rejected, ...moving],
            };
            break;
          }
          case 'restoreReject': {
            const toRestore = new Set(meta.opIds as string[] | undefined || state.rejected.map((i) => i.opId));
            const back = state.rejected.filter((i) => toRestore.has(i.opId));
            state = {
              ...state,
              rejected: state.rejected.filter((i) => !toRestore.has(i.opId)),
              items: [...state.items, ...back],
            };
            break;
          }
          case 'setRunning':
            state = { ...state, running: meta.running };
            break;
          case 'setPart':
            state = { ...state, part: meta.part };
            break;
          case 'clear':
            state = { ...INITIAL };
            break;
          case 'focus':
            state = { ...state, focus: meta.focus };
            break;
        }
      }

      // Map positions on doc changes (TR-015: call as method, never detach)
      if (tr.docChanged) {
        const items = state.items.map((item) => {
          const from = tr.mapping.map(item.from, 1);
          const to = tr.mapping.map(item.to, -1);
          const anchorPos =
            item.anchorPos !== undefined
              ? tr.mapping.map(item.anchorPos, 1)
              : undefined;
          let status: ItemStatus = item.status;
          if (
            status === 'pending' &&
            (item.kind === 'replace' || item.kind === 'delete' || item.kind === 'move') &&
            from >= to
          ) {
            status = 'stale';
          }
          return { ...item, from, to, anchorPos, status };
        });
        const rejected = state.rejected.map((item) => {
          const from = tr.mapping.map(item.from, 1);
          const to = tr.mapping.map(item.to, -1);
          const anchorPos =
            item.anchorPos !== undefined
              ? tr.mapping.map(item.anchorPos, 1)
              : undefined;
          return { ...item, from, to, anchorPos };
        });
        state = { ...state, items, rejected };
      }

      return state;
    },
  },
});

// ---------- extension ----------

export const SuggestExtension = Extension.create({
  name: 'suggest',
  addProseMirrorPlugins() {
    return [plugin];
  },
});

// ---------- public API ----------

export function getSuggestState(editor: Editor): SuggestState {
  return suggestKey.getState(editor.view.state) ?? INITIAL;
}

function dispatchMeta(editor: Editor, meta: Record<string, unknown>): void {
  const tr = editor.state.tr;
  tr.setMeta(suggestKey, meta);
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

export function startRequest(editor: Editor, requestId: string, text: string): void {
  dispatchMeta(editor, { type: 'start', requestId, text });
}

export function addItem(editor: Editor, item: Item): void {
  dispatchMeta(editor, { type: 'add', item });
}

export function rejectItems(editor: Editor, opIds: string[]): void {
  dispatchMeta(editor, { type: 'reject', opIds });
}

export function undoReject(editor: Editor, opIds?: string[]): void {
  dispatchMeta(editor, { type: 'restoreReject', opIds });
}

export function clearSuggestions(editor: Editor): void {
  dispatchMeta(editor, { type: 'clear' });
}

export function setRunning(editor: Editor, running: boolean): void {
  dispatchMeta(editor, { type: 'setRunning', running });
}

export function setPart(editor: Editor, part: string | null): void {
  dispatchMeta(editor, { type: 'setPart', part });
}

export function setFocus(editor: Editor, focus: number | null): void {
  dispatchMeta(editor, { type: 'focus', focus });
}

export function isEditRunning(editor: Editor): boolean {
  return getSuggestState(editor).running;
}
