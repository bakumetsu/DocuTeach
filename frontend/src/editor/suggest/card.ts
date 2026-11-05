import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { getSuggestState, setFocus, suggestKey, type Item } from './plugin';
import { nodeMarkdown } from './snapshot';
import { wordDiff } from './diff';
import { acceptItem, rejectItem } from './apply';
import { useApp } from '../../state/store';

export type BadgeTone = 'amber' | 'grey';

export interface Badge {
  key: string;
  label: string;
  tone: BadgeTone;
}

export const BLOCKING_FLAGS: readonly string[] = [
  'ai_answer',
  'large_rewrite',
  'removes_a_lot',
];

export function badgesFor(item: Item): Badge[] {
  const badges: Badge[] = [];
  const has = (flag: string): boolean => item.flags.includes(flag);

  if (has('ai_answer')) {
    badges.push({ key: 'ai_answer', label: 'AI answer: check it', tone: 'amber' });
  }
  if (has('changes_protected')) {
    badges.push({
      key: 'changes_protected',
      label: 'Changes a note or answer',
      tone: 'amber',
    });
  }
  if (has('large_rewrite')) {
    badges.push({ key: 'large_rewrite', label: 'Large rewrite', tone: 'grey' });
  }
  if (has('removes_a_lot')) {
    badges.push({ key: 'removes_a_lot', label: 'Removes a lot', tone: 'grey' });
  }
  if (has('removes_blank')) {
    badges.push({ key: 'removes_blank', label: 'Removes a blank', tone: 'grey' });
  }
  if (has('removes_text')) {
    badges.push({ key: 'removes_text', label: 'Removes text', tone: 'grey' });
  }
  if (has('formatting_reset')) {
    badges.push({ key: 'formatting_reset', label: 'Formatting reset', tone: 'grey' });
  }

  return badges;
}

export function hasBlockingFlag(item: Item): boolean {
  return item.flags.some((flag) => BLOCKING_FLAGS.includes(flag));
}

export function oldMarkdown(editor: Editor, item: Item): string {
  if (item.kind === 'insert') {
    return '';
  }

  try {
    const doc = editor.state.doc;
    const parts: string[] = [];
    let offset = 0;

    doc.forEach((node) => {
      const end = offset + node.nodeSize;
      if (offset < item.to && end > item.from) {
        parts.push(nodeMarkdown(editor, node));
      }
      offset = end;
    });

    return parts.join('').trim();
  } catch {
    return '';
  }
}

function firstSixWords(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 6) {
    return words.join(' ');
  }
  return `${words.slice(0, 6).join(' ')}…`;
}

export function cardTitle(item: Item, newText: string): string {
  switch (item.kind) {
    case 'insert':
      return 'Add here';
    case 'delete':
      return 'Remove';
    case 'replace':
      return 'Change';
    case 'move':
      return `Move here: ${firstSixWords(newText)}`;
  }
}

function appendRich(
  parent: HTMLElement,
  text: string,
  wrapTag?: 'ins' | 'del',
): void {
  const target = wrapTag
    ? document.createElement(wrapTag)
    : parent;

  if (wrapTag) {
    target.className = `diff-${wrapTag}`;
  }

  const pieces = text.split(/(\{\{[^}]*\}\})/u);

  for (const piece of pieces) {
    if (piece === '') {
      continue;
    }

    if (/^\{\{[^}]*\}\}$/u.test(piece)) {
      const inner = piece.slice(2, -2).trim();
      const blank = document.createElement('span');
      const blankMain = document.createElement('span');
      blank.className = 'blank';
      blankMain.className = 'blank-main';
      blankMain.textContent = inner;
      blank.appendChild(blankMain);
      target.appendChild(blank);
    } else {
      target.appendChild(document.createTextNode(piece));
    }
  }

  if (target !== parent) {
    parent.appendChild(target);
  }
}

export function buildCard(
  editor: Editor,
  item: Item,
  index: number,
): HTMLElement {
  const newText = item.markdown ?? '';
  const oldText = oldMarkdown(editor, item);
  const title = cardTitle(item, newText);

  const card = document.createElement('div');
  card.className = 'suggest-card';
  card.contentEditable = 'false';
  card.tabIndex = 0;
  card.setAttribute('role', 'group');
  card.dataset.opId = item.opId;
  card.dataset.index = String(index);
  card.setAttribute('aria-label', title);

  const head = document.createElement('div');
  head.className = 'suggest-head';

  const titleEl = document.createElement('span');
  titleEl.className = 'suggest-title';
  titleEl.textContent = title;
  head.appendChild(titleEl);

  const badgesEl = document.createElement('div');
  badgesEl.className = 'suggest-badges';
  for (const badge of badgesFor(item)) {
    const badgeEl = document.createElement('span');
    badgeEl.className = `suggest-badge tone-${badge.tone}`;
    badgeEl.textContent = badge.label;
    badgesEl.appendChild(badgeEl);
  }
  head.appendChild(badgesEl);

  const actions = document.createElement('div');
  actions.className = 'suggest-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'suggest-accept';
  acceptBtn.textContent = '✓';
  acceptBtn.title = 'Accept (Ctrl+Enter)';
  acceptBtn.setAttribute('aria-label', 'Accept (Ctrl+Enter)');

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'suggest-reject';
  rejectBtn.textContent = '✕';
  rejectBtn.title = 'Reject';
  rejectBtn.setAttribute('aria-label', 'Reject');

  if (item.status === 'stale') {
    acceptBtn.disabled = true;
    card.classList.add('is-stale');
  }

  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);
  head.appendChild(actions);
  card.appendChild(head);

  if (item.status === 'stale') {
    const stale = document.createElement('div');
    stale.className = 'suggest-stale';
    stale.textContent = 'Text changed since the suggestion: Dismiss or ask again';
    card.appendChild(stale);
  }

  const cols = document.createElement('div');
  cols.className = 'suggest-cols';

  const left = document.createElement('div');
  left.className = 'suggest-col suggest-now';
  const leftLabel = document.createElement('div');
  leftLabel.className = 'suggest-col-label';
  leftLabel.textContent = 'Now';
  left.appendChild(leftLabel);

  const right = document.createElement('div');
  right.className = 'suggest-col suggest-new';
  const rightLabel = document.createElement('div');
  rightLabel.className = 'suggest-col-label';
  rightLabel.textContent = 'Suggested';
  right.appendChild(rightLabel);

  switch (item.kind) {
    case 'replace': {
      const diff = wordDiff(oldText, newText);
      for (const seg of diff.old) {
        appendRich(left, seg.text, seg.changed ? 'del' : undefined);
      }
      for (const seg of diff.next) {
        appendRich(right, seg.text, seg.changed ? 'ins' : undefined);
      }
      break;
    }
    case 'insert': {
      cols.classList.add('only-new');
      appendRich(right, newText);
      break;
    }
    case 'delete': {
      appendRich(left, oldText, 'del');
      const removed = document.createElement('span');
      removed.className = 'suggest-removed';
      removed.textContent = '(removed)';
      right.appendChild(removed);
      break;
    }
    case 'move': {
      appendRich(left, oldText, 'del');
      appendRich(right, newText);
      break;
    }
  }

  if (item.kind !== 'insert') {
    cols.appendChild(left);
  }
  cols.appendChild(right);
  card.appendChild(cols);

  const accept = (e?: Event): void => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const result = acceptItem(editor, item.opId);
    if (!result.ok && result.message) {
      useApp.getState().showToast(result.message);
    }
  };

  const reject = (e?: Event): void => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    rejectItem(editor, item.opId);
  };

  acceptBtn.addEventListener('click', accept);
  rejectBtn.addEventListener('click', reject);

  card.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      accept(e);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      editor.commands.focus();
      return;
    }

    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      stepFocus(editor, 1);
      return;
    }

    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      stepFocus(editor, -1);
      return;
    }
  });

  card.addEventListener('focus', () => {
    const focus = getSuggestState(editor).focus;
    if (focus !== index) {
      setFocus(editor, index);
    }
  });

  return card;
}

export function focusCard(editor: Editor, index: number): void {
  const parentCards = editor.view.dom.parentElement?.querySelectorAll<HTMLElement>('.suggest-card');
  const cards =
    parentCards && parentCards.length > 0
      ? parentCards
      : editor.view.dom.querySelectorAll<HTMLElement>('.suggest-card');

  const el = cards.item(index);
  if (!el) {
    return;
  }

  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  el.focus({ preventScroll: true });
  setFocus(editor, index);
}

export function stepFocus(editor: Editor, dir: 1 | -1): void {
  const state = getSuggestState(editor);
  const n = state.items.length;
  if (n === 0) {
    return;
  }

  const current = state.focus ?? (dir === 1 ? -1 : n);
  const next = (((current + dir) % n) + n) % n;

  focusCard(editor, next);
}

export const SuggestCardExtension = Extension.create({
  name: 'suggestCards',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('suggestCards'),

        props: {
          decorations(state) {
            const suggest = suggestKey.getState(state);
            if (!suggest) {
              return DecorationSet.create(state.doc, []);
            }

            const doc = state.doc;
            const limit = doc.content.size;
            const decos: Decoration[] = [];

            suggest.items.forEach((item, i) => {
              const positions = [item.from, item.to];
              if (item.anchorPos !== undefined) {
                positions.push(item.anchorPos);
              }

              if (positions.some((p) => p < 0 || p > limit)) {
                return;
              }

              if (item.kind !== 'insert') {
                const className =
                  item.kind === 'move'
                    ? 'suggest-target kind-move-source'
                    : `suggest-target kind-${item.kind}`;

                let offset = 0;
                doc.forEach((node) => {
                  const end = offset + node.nodeSize;
                  if (offset < item.to && end > item.from) {
                    decos.push(
                      Decoration.node(offset, end, { class: className }),
                    );
                  }
                  offset = end;
                });
              }

              const pos =
                item.kind === 'insert'
                  ? item.from
                  : item.kind === 'move'
                    ? (item.anchorPos ?? item.to)
                    : item.to;

              decos.push(
                Decoration.widget(pos, () => buildCard(editor, item, i), {
                  side: 1,
                  key: `suggest-${item.opId}-${item.status}-${i}`,
                  ignoreSelection: true,
                  stopEvent: () => true,
                }),
              );
            });

            return DecorationSet.create(doc, decos);
          },

          handleKeyDown(view, event) {
            const suggest = suggestKey.getState(view.state);
            if (!suggest) {
              return false;
            }

            if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              if (suggest.items.length === 0) {
                return false;
              }

              stepFocus(editor, event.key === 'ArrowDown' ? 1 : -1);
              return true;
            }

            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              if (suggest.focus === null) {
                return false;
              }

              const item = suggest.items[suggest.focus];
              if (!item) {
                return false;
              }

              const result = acceptItem(editor, item.opId);
              if (!result.ok && result.message) {
                useApp.getState().showToast(result.message);
              }

              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
