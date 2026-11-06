import type { Editor } from '@tiptap/core';
import type { EditScope, EditBlock } from '../../api/types';
import { api } from '../../api';
import { useChats } from '../../assistant/chatStore';
import { useApp } from '../../state/store';
import { noteStreamError, clearAiNotice } from '../../assistant/aiNotice';
import { nodeMarkdown, buildSnapshot } from './snapshot';
import type { Snapshot } from './snapshot';
import {
  startRequest,
  addItem,
  setRunning,
  setReply,
  addSkipped,
  isEditRunning,
  markLargeRewrite,
  type Item,
} from './plugin';
import { isStreaming } from '../stream';

let current: { controller: AbortController; requestId: string } | null = null;

export function cancelPageEdit(editor: Editor): boolean {
  if (!current) return false;
  current.controller.abort();
  void api.chats.release('page');
  setRunning(editor, false);
  current = null;
  return true;
}

export function startPageEdit(
  editor: Editor,
  opts: { instruction: string; scope: EditScope; allowProtected: boolean },
): boolean {
  if (isStreaming() || isEditRunning(editor)) {
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
  if (modelStatus[model]?.status !== 'ready' && modelStatus[model]?.status !== 'unloaded') {
    useApp.getState().showToast('Pick a ready model first');
    return false;
  }

  const requestId = crypto.randomUUID();
  const snap = buildSnapshot(editor, requestId, 'page');
  if (snap.blocks.length === 0 || editor.state.doc.textContent.trim() === '') {
    useApp.getState().showToast('Nothing to edit');
    return false;
  }

  const scopeIndices = computeScope(editor, snap, opts.scope);
  if (scopeIndices.length === 0) {
    useApp.getState().showToast('Nothing to edit');
    return false;
  }

  const blocks = buildPayloadBlocks(editor, snap, scopeIndices);

  startRequest(editor, requestId, opts.instruction);
  setRunning(editor, true);

  const controller = new AbortController();
  current = { controller, requestId };

  const scopeSet = new Set(scopeIndices);
  const blockIdToIdx = new Map<string, number>();
  snap.blocks.forEach((b, i) => blockIdToIdx.set(b.id, i));
  const hit = new Set<number>();
  let anyLargeRewrite = false;

  void (async () => {
    let accumulated = '';
    try {
      const stream = api.chat.stream(
        {
          chatId: 'page',
          model,
          messages: [{ role: 'user', content: opts.instruction }],
          mode: 'edit',
          edit: {
            instruction: opts.instruction,
            scope: opts.scope,
            allowProtected: opts.allowProtected,
            blocks,
          },
        },
        controller.signal,
      );

      for await (const event of stream) {
        if (controller.signal.aborted) break;

        switch (event.type) {
          case 'token':
            clearAiNotice();
            accumulated += event.text;
            setReply(editor, accumulated);
            break;
          case 'edit': {
            if (event.targets.length === 0) {
              addSkipped(editor, 'out_of_scope', `${event.kind} (no target)`);
              break;
            }
            const targetId = event.targets[0];
            const targetIdx = blockIdToIdx.get(targetId);
            if (targetIdx === undefined || !scopeSet.has(targetIdx)) {
              addSkipped(editor, 'out_of_scope', `${event.kind} ${targetId}`);
              break;
            }
            const targetBlock = snap.blocks[targetIdx];
            const node = editor.state.doc.child(targetIdx);

            const item: Item = {
              opId: event.opId,
              kind: event.kind,
              from: targetBlock.from,
              to: targetBlock.to,
              baseHash: targetBlock.hash,
              markdown: event.markdown,
              flags: event.flags,
              status: 'pending',
              requestId,
            };

            if (event.flags.includes('large_rewrite')) {
              anyLargeRewrite = true;
            }

            if (event.kind === 'replace' || event.kind === 'delete') {
              hit.add(targetIdx);
            } else if (event.kind === 'insert') {
              const anchorIdx = blockIdToIdx.get(event.anchor ?? '');
              if (anchorIdx !== undefined) {
                const anchorBlock = snap.blocks[anchorIdx];
                item.from = anchorBlock.from;
                item.to = anchorBlock.from;
                item.anchorPos = event.side === 'before' ? anchorBlock.from : anchorBlock.to - 1;
                item.baseHash = anchorBlock.hash;
              }
            } else if (event.kind === 'move') {
              item.markdown = nodeMarkdown(editor, node);
              const anchorIdx = blockIdToIdx.get(event.anchor ?? '');
              if (anchorIdx !== undefined) {
                const anchorBlock = snap.blocks[anchorIdx];
                item.anchorPos = event.side === 'before' ? anchorBlock.from : anchorBlock.to - 1;
              }
            }

            addItem(editor, item);
            break;
          }
          case 'edit_skipped':
            addSkipped(editor, event.code, event.header);
            break;
          case 'error':
            noteStreamError(event.code);
            useApp.getState().showToast(event.message || 'Stream error');
            return;
          case 'done':
            clearAiNotice();
            break;
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        useApp.getState().showToast('Stream failed');
      }
      return;
    } finally {
      if (current?.requestId === requestId) {
        current = null;
        setRunning(editor, false);
        void api.chats.release('page');
      }
    }

    if (controller.signal.aborted) return;
    if ((scopeIndices.length >= 3 && hit.size > scopeIndices.length / 2) || anyLargeRewrite) {
      markLargeRewrite(editor, requestId);
    }
  })();

  return true;
}

function computeScope(editor: Editor, snap: Snapshot, scope: EditScope): number[] {
  if (scope === 'lesson') {
    return snap.blocks.map((_, i) => i);
  }
  if (scope === 'selection') {
    const sel = editor.state.selection;
    const indices: number[] = [];
    snap.blocks.forEach((b, i) => {
      if (b.from < sel.to && b.to > sel.from) {
        indices.push(i);
      }
    });
    return indices;
  }
  // section
  const selStart = editor.state.selection.from;
  let selBlockIdx = 0;
  for (let i = 0; i < snap.blocks.length; i++) {
    if (snap.blocks[i].from <= selStart && selStart < snap.blocks[i].to) {
      selBlockIdx = i;
      break;
    }
    if (i === snap.blocks.length - 1 && selStart >= snap.blocks[i].to) {
      selBlockIdx = i;
    }
  }
  let headingIdx = -1;
  for (let i = selBlockIdx; i >= 0; i--) {
    if (snap.blocks[i].kind === 'heading') {
      headingIdx = i;
      break;
    }
  }
  const from = headingIdx >= 0 ? headingIdx : 0;
  let to = snap.blocks.length;
  for (let i = from + 1; i < snap.blocks.length; i++) {
    if (snap.blocks[i].kind === 'heading') {
      to = i;
      break;
    }
  }
  const indices: number[] = [];
  for (let i = from; i < to; i++) indices.push(i);
  return indices;
}

function buildPayloadBlocks(editor: Editor, snap: Snapshot, scopeIndices: number[]): EditBlock[] {
  const scopeSet = new Set(scopeIndices);
  const minScope = Math.min(...scopeIndices);
  const maxScope = Math.max(...scopeIndices);
  const contextBefore: number[] = [];
  for (let i = minScope - 1; i >= 0 && contextBefore.length < 2; i--) {
    contextBefore.push(i);
  }
  contextBefore.reverse();
  const contextAfter: number[] = [];
  for (let i = maxScope + 1; i < snap.blocks.length && contextAfter.length < 2; i++) {
    contextAfter.push(i);
  }

  const allIndices: number[] = [...contextBefore, ...scopeIndices, ...contextAfter];
  return allIndices.map((i) => {
    const node = editor.state.doc.child(i);
    const role: 'edit' | 'context' = scopeSet.has(i) ? 'edit' : 'context';
    return { id: snap.blocks[i].id, kind: snap.blocks[i].kind, md: nodeMarkdown(editor, node), role };
  });
}
