import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { serializeMarkdown } from '../../markdown/serialize';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashText(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) as number;
    if (cp > 0xffff) i++;
    h ^= cp;
    h = Math.imul(h, FNV_PRIME);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface SnapshotBlock {
  id: string;
  from: number;
  to: number;
  hash: string;
  kind: string;
}

export interface Snapshot {
  requestId: string;
  lessonId: string;
  blocks: SnapshotBlock[];
}

export function nodeMarkdown(editor: Editor, node: PMNode): string {
  const tempDoc = editor.schema.node('doc', null, [node]);
  return serializeMarkdown(tempDoc);
}

export function buildSnapshot(
  editor: Editor,
  requestId: string,
  lessonId: string,
): Snapshot {
  const doc = editor.state.doc;
  const blocks: SnapshotBlock[] = [];
  let pos = 0;
  let idx = 0;
  doc.forEach((node) => {
    const from = pos;
    const to = pos + node.nodeSize;
    const hash = hashText(nodeMarkdown(editor, node));
    blocks.push({ id: `b${idx}`, from, to, hash, kind: node.type.name });
    pos = to;
    idx++;
  });
  return { requestId, lessonId, blocks };
}

export function rangeHash(editor: Editor, from: number, to: number): string {
  const doc = editor.state.doc;
  const parts: string[] = [];
  let pos = 0;
  doc.forEach((node) => {
    const nodeEnd = pos + node.nodeSize;
    if (pos < to && nodeEnd > from) {
      parts.push(nodeMarkdown(editor, node));
    }
    pos = nodeEnd;
  });
  return hashText(parts.join(''));
}
