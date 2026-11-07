import { Node } from '@tiptap/pm/model';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Walk the ProseMirror doc in document order; push each text node's text,
 * and for each `blank` node push each answer string (from the `answers` attr).
 */
export function words(doc: Node): string[] {
  const result: string[] = [];
  doc.descendants((node) => {
    if (node.isText) {
      result.push(node.text!);
    } else if (node.type.name === 'blank') {
      const answers: string[] = node.attrs.answers ?? [];
      for (const a of answers) {
        result.push(a);
      }
    }
    return true;
  });
  return result;
}

/**
 * Return a new doc node of the same type/attrs with empty top-level
 * paragraphs removed.
 */
export function dropEmptyTop(doc: Node): Node {
  const children: Node[] = [];
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)!;
    if (child.type.name === 'paragraph' && child.content.size === 0) continue;
    children.push(child);
  }
  return doc.type.create(doc.attrs, children);
}

/**
 * Read `test/<rel>` relative to process.cwd() as utf-8.
 * No newline conversion is performed.
 */
export function readFixture(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'test', rel), 'utf8');
}
