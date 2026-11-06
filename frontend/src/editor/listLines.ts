// Toggle list lines: converts top-level paragraphs/headings to list items (splitting hardBreaks) and back.
import type { Editor } from '@tiptap/core';
import { Fragment, Node as PMNode } from '@tiptap/pm/model';

export function toggleListLines(editor: Editor, kind: 'bullet' | 'ordered'): boolean {
  const { state, schema } = editor;
  const { doc } = state;

  let from = Infinity;
  let to = -Infinity;
  for (const range of state.selection.ranges) {
    if (range.$from.pos < from) from = range.$from.pos;
    if (range.$to.pos > to) to = range.$to.pos;
  }

  const targetListName = kind === 'bullet' ? 'bulletList' : 'orderedList';
  const targetListType = schema.nodes[targetListName];

  interface Entry {
    node: PMNode;
    offset: number;
    cls: 'convertible' | 'list' | 'other';
    listKind?: 'bullet' | 'ordered';
  }

  const entries: Entry[] = [];
  doc.forEach((child, offset) => {
    const end = offset + child.nodeSize;
    const selected =
      (end > from && offset < to) ||
      (from === to && offset < from && from < end);
    if (!selected) return;

    if (child.type.name === 'paragraph' || child.type.name === 'heading') {
      entries.push({ node: child, offset, cls: 'convertible' });
    } else if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
      entries.push({
        node: child,
        offset,
        cls: 'list',
        listKind: child.type.name === 'bulletList' ? 'bullet' : 'ordered',
      });
    } else {
      entries.push({ node: child, offset, cls: 'other' });
    }
  });

  const listsOfKind = entries.filter((e) => e.cls === 'list' && e.listKind === kind);
  const convertibles = entries.filter((e) => e.cls === 'convertible');

  if (listsOfKind.length > 0 && convertibles.length === 0) {
    const tr = state.tr;
    const replacements: { start: number; end: number; fragment: Fragment }[] = [];

    for (const e of listsOfKind) {
      const children: PMNode[] = [];
      e.node.forEach((child) => {
        children.push(child);
      });

      let firstTouched = -1;
      let lastTouched = -1;
      let itemStart = e.offset + 1;

      for (let i = 0; i < children.length; i++) {
        const itemEnd = itemStart + children[i].nodeSize;
        const touched =
          (itemEnd > from && itemStart < to) ||
          (from === to && itemStart < from && from < itemEnd);

        if (touched) {
          if (firstTouched === -1) firstTouched = i;
          lastTouched = i;
        }
        itemStart = itemEnd;
      }

      if (firstTouched === -1) continue;

      const nodes: PMNode[] = [];

      if (firstTouched > 0) {
        const beforeItems = children.slice(0, firstTouched);
        nodes.push(e.node.type.create(e.node.attrs, Fragment.fromArray(beforeItems)));
      }

      for (let i = firstTouched; i <= lastTouched; i++) {
        children[i].descendants((n) => {
          if (n.type.name === 'paragraph' || n.type.name === 'heading') {
            nodes.push(schema.nodes.paragraph.create(null, n.content));
          }
          return true;
        });
      }

      if (lastTouched < children.length - 1) {
        const afterItems = children.slice(lastTouched + 1);
        const attrs =
          kind === 'ordered'
            ? { ...e.node.attrs, start: Number(e.node.attrs.start ?? 1) + lastTouched + 1 }
            : e.node.attrs;
        nodes.push(e.node.type.create(attrs, Fragment.fromArray(afterItems)));
      }

      replacements.push({
        start: e.offset,
        end: e.offset + e.node.nodeSize,
        fragment: Fragment.fromArray(nodes),
      });
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      tr.replaceWith(r.start, r.end, r.fragment);
    }

    if (!tr.doc.eq(doc)) {
      editor.view.dispatch(tr);
      return true;
    }
    return false;
  }

  const tr = state.tr;

  for (const e of entries) {
    if (e.cls === 'list' && e.listKind !== kind) {
      tr.setNodeMarkup(e.offset, targetListType);
    }
  }

  const runs: Entry[][] = [];
  let current: Entry[] = [];
  for (const e of entries) {
    if (e.cls === 'convertible') {
      if (current.length > 0) {
        const prev = current[current.length - 1];
        if (e.offset === prev.offset + prev.node.nodeSize) {
          current.push(e);
          continue;
        }
      }
      if (current.length > 0) runs.push(current);
      current = [e];
    } else {
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) runs.push(current);

  const runReplacements: { start: number; end: number; node: PMNode }[] = [];
  for (const run of runs) {
    const listItems: PMNode[] = [];
    for (const entry of run) {
      const lines: PMNode[][] = [[]];
      entry.node.forEach((child) => {
        if (child.type.name === 'hardBreak') {
          lines.push([]);
        } else {
          lines[lines.length - 1].push(child);
        }
      });
      for (const line of lines) {
        const para = schema.nodes.paragraph.create(null, Fragment.fromArray(line));
        const item = schema.nodes.listItem.create(null, [para]);
        listItems.push(item);
      }
    }
    const listNode = targetListType.create(null, Fragment.fromArray(listItems));
    const start = run[0].offset;
    const last = run[run.length - 1];
    const end = last.offset + last.node.nodeSize;
    runReplacements.push({ start, end, node: listNode });
  }

  runReplacements.sort((a, b) => b.start - a.start);
  for (const r of runReplacements) {
    tr.replaceWith(r.start, r.end, r.node);
  }

  if (!tr.doc.eq(doc)) {
    editor.view.dispatch(tr);
    return true;
  }
  return false;
}
