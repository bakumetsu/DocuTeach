import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Pure function: returns a NEW document safe for student display.
 * - Removes every `teacherNote` and `rawBlock` node at any depth.
 * - Every `blank` gets `answers: []`.
 * - Every `mcqOption` gets `correct: false`.
 * - Every `mcq` gets `multi` = (original correct-option count > 1) OR preserved
 *   from a prior projection (since a student doc has all `correct` cleared).
 * - `splitPoint` and all other nodes/marks are preserved.
 * - Doc attr `meta` is replaced by `{ raw: '', data: null, broken: false }`.
 * - An empty result gets one empty paragraph.
 */
export function projectStudent(doc: PMNode): PMNode {
  const children = transformChildren(doc);

  let finalChildren = children;
  if (finalChildren.length === 0) {
    const emptyP = doc.type.schema.nodes.paragraph.createAndFill();
    if (emptyP) {
      finalChildren = [emptyP];
    }
  }

  return doc.type.create(
    { meta: { raw: '', data: null, broken: false } },
    finalChildren,
  );
}

function transformChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child: PMNode) => {
    const t = transformNode(child);
    if (t !== null) {
      out.push(t);
    }
  });
  return out;
}

function transformNode(node: PMNode): PMNode | null {
  const name = node.type.name;

  // Remove teacher-only nodes entirely
  if (name === 'teacherNote' || name === 'rawBlock') {
    return null;
  }

  // Text nodes carry no teacher data — return as-is
  if (node.isText) {
    return node;
  }

  let attrs = node.attrs;

  if (name === 'blank') {
    attrs = { ...node.attrs, answers: [] };
  } else if (name === 'mcqOption') {
    attrs = { ...node.attrs, correct: false };
  } else if (name === 'mcq') {
    const correctCount = countCorrectOptions(node);
    attrs = { ...node.attrs, multi: correctCount > 1 || node.attrs.multi === true };
  }

  // Non-text leaf (e.g. image, splitPoint, blank-as-leaf)
  if (node.isLeaf) {
    return node.type.create(attrs);
  }

  // Branch node: recurse into children
  const children = transformChildren(node);
  return node.type.create(attrs, children);
}

function countCorrectOptions(mcqNode: PMNode): number {
  let count = 0;
  mcqNode.forEach((child: PMNode) => {
    if (child.type.name === 'mcqOption' && child.attrs.correct === true) {
      count++;
    }
  });
  return count;
}
