import { describe, it } from 'vitest';
import type { Node as PMNode, Mark } from '@tiptap/pm/model';
import { schema } from '../src/editor/extensions';
import { parseMarkdown } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';
import { dropEmptyTop } from './helpers';

/* ---------- helpers ---------- */

function makeDoc(blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(
    { meta: { raw: '', data: null, broken: false } },
    blocks,
  );
}

function roundtrip(doc: PMNode): PMNode {
  return dropEmptyTop(parseMarkdown(serializeMarkdown(doc)).doc);
}

function check(doc: PMNode, expected?: PMNode): void {
  const rt = roundtrip(doc);
  const exp = expected ?? dropEmptyTop(doc);
  const serialized = JSON.stringify(serializeMarkdown(doc));
  const rtStr = rt.toString();
  const expStr = exp.toString();
  if (!rt.eq(exp)) throw new Error(`Round-trip failed.\nSerialized: ${serialized}\nRound-trip: ${rtStr}\nExpected: ${expStr}`);
}

/* mark factories */
const mBold = () => schema.marks.bold.create();
const mItalic = () => schema.marks.italic.create();
const mUnderline = () => schema.marks.underline.create();
const mHighlight = () => schema.marks.highlight.create();

/* node shortcuts */
const para = (content: PMNode[], align: string = 'left') =>
  schema.nodes.paragraph.create({ align }, content);

const heading = (level: number, content: PMNode[]) =>
  schema.nodes.heading.create({ level }, content);

const bulletList = (items: PMNode[]) =>
  schema.nodes.bulletList.create(null, items);

const orderedList = (items: PMNode[]) =>
  schema.nodes.orderedList.create(null, items);

const listItem = (content: PMNode[]) =>
  schema.nodes.listItem.create(null, content);

const teacherNote = (tag: string, content: PMNode[]) =>
  schema.nodes.teacherNote.create({ tag }, content);

const blank = (answers: string[]) =>
  schema.nodes.blank.create({ answers });

const table = (rows: PMNode[]) =>
  schema.nodes.table.create(null, rows);

const tableRow = (cells: PMNode[]) =>
  schema.nodes.tableRow.create(null, cells);

const tableCell = (content: PMNode[]) =>
  schema.nodes.tableCell.create(null, content);

const tableHeader = (content: PMNode[]) =>
  schema.nodes.tableHeader.create(null, content);

const hardBreak = () =>
  schema.nodes.hardBreak.create(null);

const splitPoint = (label: string) =>
  schema.nodes.splitPoint.create({ label });

const rawBlock = (text: string) =>
  schema.nodes.rawBlock.create({ text });

const text = (str: string, marks: readonly Mark[] = []) =>
  schema.text(str, [...marks]);

/* ---------- Part A: hand-built documents ---------- */

describe('Property: round-trip (hand-built)', () => {
  it('1. bold "Note:" followed by plain "Use" (flanking fallback)', () => {
    const doc = makeDoc([
      para([text('Note:', [mBold()]), text('Use', [])]),
    ]);
    check(doc);
  });

  it('2. bold "a" immediately followed by italic "b" (touching runs)', () => {
    const doc = makeDoc([
      para([text('a', [mBold()]), text('b', [mItalic()])]),
    ]);
    check(doc);
  });

  it('3. bold "bold " + bold+italic "italic"', () => {
    const doc = makeDoc([
      para([text('bold ', [mBold()]), text('italic', [mBold(), mItalic()])]),
    ]);
    check(doc);
  });

  it('4. underline+highlight+bold+italic on one word', () => {
    const doc = makeDoc([
      para([text('word', [mUnderline(), mHighlight(), mBold(), mItalic()])]),
    ]);
    check(doc);
  });

  it('5. center paragraph + teacherNote center (serializer ignores note align)', () => {
    const doc = makeDoc([
      para([text('Centered', [])], 'center'),
      teacherNote('', [para([text('hi', [])], 'center')]),
    ]);
    const expected = makeDoc([
      para([text('Centered', [])], 'center'),
      teacherNote('', [para([text('hi', [])], 'left')]),
    ]);
    check(doc, expected);
  });

  it('6. one-item bullet list "[x] only" (stays bullet, no mcq)', () => {
    const doc = makeDoc([
      bulletList([listItem([para([text('[x] only', [])])])]),
    ]);
    check(doc);
  });

  it('7. mcq with question, 3 options, 2 correct, multi true', () => {
    const doc = makeDoc([
      schema.nodes.mcq.create({ multi: true }, [
        schema.nodes.mcqQuestion.create(null, [schema.text('She ______ in Hanoi since 2019.')]),
        schema.nodes.mcqOption.create({ correct: false }, [schema.text('lives')]),
        schema.nodes.mcqOption.create({ correct: true }, [schema.text('has lived')]),
        schema.nodes.mcqOption.create({ correct: true }, [schema.text('have lived')]),
      ]),
    ]);
    check(doc);
  });

  it('8. mcq with empty question preceded by a paragraph', () => {
    const doc = makeDoc([
      para([text('Choose the best answer:', [])]),
      schema.nodes.mcq.create({ multi: false }, [
        schema.nodes.mcqQuestion.create(null, []),
        schema.nodes.mcqOption.create({ correct: true }, [schema.text('one')]),
        schema.nodes.mcqOption.create({ correct: false }, [schema.text('two')]),
      ]),
    ]);
    check(doc);
  });

  it('9. blank with answers [a|b, c}d, e\\f] and an empty blank', () => {
    const doc = makeDoc([
      para([
        blank(['a|b', 'c}d', 'e\\f']),
        text(' '),
        blank([]),
      ]),
    ]);
    check(doc);
  });

  it('10. table 2x2 with a blank and a literal | in a cell', () => {
    const doc = makeDoc([
      table([
        tableRow([
          tableHeader([para([text('a', [])])]),
          tableHeader([para([text('b|c', [])])]),
        ]),
        tableRow([
          tableCell([para([blank(['x'])])]),
          tableCell([para([text('d', [])])]),
        ]),
      ]),
    ]);
    check(doc);
  });

  it('11. teacherNote tag He said "hi" with paragraph and bullet list', () => {
    const doc = makeDoc([
      teacherNote('He said "hi"', [
        para([text('hello', [])]),
        bulletList([listItem([para([text('item', [])])])]),
      ]),
    ]);
    check(doc);
  });

  it('12. all specials in one paragraph', () => {
    const doc = makeDoc([
      para([
        text('a == b {{ c }} <b> &amp; 1. * _ [x] \\ # > - + ::: ~ `', []),
      ]),
    ]);
    check(doc);
  });

  it('13. paragraphs of only "______", "---", "***"', () => {
    const doc = makeDoc([
      para([text('______', [])]),
      para([text('---', [])]),
      para([text('***', [])]),
    ]);
    check(doc);
  });

  it('14. "x" + hardBreak + "2. y" + hardBreak + "# z"', () => {
    const doc = makeDoc([
      para([
        text('x', []),
        hardBreak(),
        text('2. y', []),
        hardBreak(),
        text('# z', []),
      ]),
    ]);
    check(doc);
  });

  it('15. heading level 2 with text "1. Rule"', () => {
    const doc = makeDoc([
      heading(2, [text('1. Rule', [])]),
    ]);
    check(doc);
  });

  it('16. splitPoint "Exam part B" + rawBlock code fence', () => {
    const doc = makeDoc([
      splitPoint('Exam part B'),
      rawBlock('```python\nprint(1)\n```'),
    ]);
    check(doc);
  });
});

/* ---------- Part B: randomized property test ---------- */

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  const sa = a.map((m) => m.type.name).sort();
  const sb = b.map((m) => m.type.name).sort();
  return sa.every((v, i) => v === sb[i]);
}

function isText(n: PMNode): n is PMNode & { text: string } {
  return n.isText;
}

function isHardBreak(n: PMNode): boolean {
  return n.type.name === 'hardBreak';
}

function isBlank(n: PMNode): boolean {
  return n.type.name === 'blank';
}

function isWsPlainText(n: PMNode): boolean {
  return isText(n) && n.text.trim() === '' && n.marks.length === 0;
}

function mergeAdjacentText(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    if (out.length > 0 && isText(n) && isText(out[out.length - 1])) {
      const prev = out[out.length - 1];
      if (marksEqual(prev.marks, n.marks)) {
        out[out.length - 1] = text(prev.text + n.text, prev.marks);
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

function stripInvalidEdges(nodes: PMNode[]): PMNode[] {
  let start = 0;
  let end = nodes.length;
  while (start < end) {
    const n = nodes[start];
    if (isHardBreak(n)) { start++; continue; }
    if (isText(n) && n.text.trim() === '') { start++; continue; }
    break;
  }
  while (end > start) {
    const n = nodes[end - 1];
    if (isHardBreak(n)) { end--; continue; }
    if (isText(n) && n.text.trim() === '') { end--; continue; }
    break;
  }
  return nodes.slice(start, end);
}

function removeConsecutiveHardBreaks(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    if (isHardBreak(n) && out.length > 0 && isHardBreak(out[out.length - 1])) {
      continue;
    }
    out.push(n);
  }
  return out;
}

function fixBlankAdjacency(nodes: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (const n of nodes) {
    if (isBlank(n)) {
      // check prev
      if (out.length > 0 && isText(out[out.length - 1]) && out[out.length - 1].marks.length > 0) {
        out.push(text(' ', []));
      }
      out.push(n);
      // check next (peek)
      continue;
    }
    // if prev is blank and current is marked text, insert space
    if (out.length > 0 && isBlank(out[out.length - 1]) && isText(n) && n.marks.length > 0) {
      out.push(text(' ', []));
    }
    out.push(n);
  }
  return out;
}

const POOL = [
  'alpha','beta','a b','*','_','[','x]',']','{{','}}','==','|','\\',
  '<b>','&amp;','1.','#','>','-','+',':::','Note:','Thì','đã','`','~',
];

const MARK_FACTORIES = [mBold, mItalic, mUnderline, mHighlight];

function generateInline(rng: () => number): PMNode[] {
  const numPieces = 1 + Math.floor(rng() * 6); // 1-6

  const raw: PMNode[] = [];

  for (let p = 0; p < numPieces; p++) {
    const str = POOL[Math.floor(rng() * POOL.length)];

    const marks: Mark[] = [];
    if (rng() < 0.4) {
      const count = 1 + Math.floor(rng() * 2); // 1 or 2
      const shuffled = [...MARK_FACTORIES].sort(() => rng() - 0.5);
      for (let m = 0; m < count; m++) {
        marks.push(shuffled[m]());
      }
    }

    raw.push(text(str, marks));

    // separator between pieces
    if (p < numPieces - 1) {
      raw.push(text(' ', []));
    }
  }

  // Maybe insert a blank (prob 0.1)
  if (rng() < 0.1 && raw.length > 1) {
    const answerPool = ['x', 'a|b', 'c}d', 'e\\f'];
    const numAns = 1 + Math.floor(rng() * 2);
    const shuffledAns = [...answerPool].sort(() => rng() - 0.5);
    const answers = shuffledAns.slice(0, numAns);
    const pos = 1 + Math.floor(rng() * (raw.length - 1));
    raw.splice(pos, 0, blank(answers));
  }

  // Maybe insert a hardBreak (prob 0.05)
  if (rng() < 0.05 && raw.length > 1) {
    const pos = 1 + Math.floor(rng() * (raw.length - 1));
    if (
      !isHardBreak(raw[pos - 1]) &&
      !isHardBreak(raw[pos]) &&
      !isWsPlainText(raw[pos - 1]) &&
      !isWsPlainText(raw[pos])
    ) {
      raw.splice(pos, 0, hardBreak());
    }
  }

  // Merge adjacent same-mark text nodes
  let nodes = mergeAdjacentText(raw);

  // Fix blank adjacency (marked text next to blank)
  nodes = fixBlankAdjacency(nodes);

  // Merge again after fix
  nodes = mergeAdjacentText(nodes);

  // Remove invalid edges
  nodes = stripInvalidEdges(nodes);

  // Remove consecutive hardBreaks
  nodes = removeConsecutiveHardBreaks(nodes);

  // Final edge strip after hardBreak removal
  nodes = stripInvalidEdges(nodes);

  if (nodes.length === 0) {
    // Fallback: single plain text
    nodes = [text('x', [])];
  }

  return nodes;
}

function generateParagraph(rng: () => number): PMNode {
  return para(generateInline(rng));
}

describe('Property: round-trip (randomized)', () => {
  it('400 iterations, seed 12345', () => {
    const SEED = 12345;
    const ITERATIONS = 400;
    const rng = mulberry32(SEED);

    for (let i = 0; i < ITERATIONS; i++) {
      const numBlocks = 1 + Math.floor(rng() * 4); // 1-4
      const blocks: PMNode[] = [];

      for (let b = 0; b < numBlocks; b++) {
        const kind = Math.floor(rng() * 5);

        // Determine the list type we are about to add (if any)
        let newListType: string | null = null;
        if (kind === 2) newListType = 'bulletList';
        else if (kind === 3) newListType = 'orderedList';

        // Avoid two adjacent lists of the same type (they merge on parse)
        if (newListType && blocks.length > 0) {
          const prev = blocks[blocks.length - 1];
          if (prev.type.name === newListType) {
            blocks.push(para([text('p', [])]));
          }
        }

        switch (kind) {
          case 0:
            blocks.push(generateParagraph(rng));
            break;
          case 1: {
            const level = 1 + Math.floor(rng() * 3); // 1-3
            blocks.push(heading(level, generateInline(rng)));
            break;
          }
          case 2: {
            const n = 1 + Math.floor(rng() * 3); // 1-3 items
            const items: PMNode[] = [];
            for (let j = 0; j < n; j++) {
              items.push(listItem([generateParagraph(rng)]));
            }
            blocks.push(bulletList(items));
            break;
          }
          case 3: {
            const n = 1 + Math.floor(rng() * 3);
            const items: PMNode[] = [];
            for (let j = 0; j < n; j++) {
              items.push(listItem([generateParagraph(rng)]));
            }
            blocks.push(orderedList(items));
            break;
          }
          case 4: {
            const tag = POOL[Math.floor(rng() * POOL.length)];
            blocks.push(teacherNote(tag, [generateParagraph(rng)]));
            break;
          }
        }
      }

      const doc = makeDoc(blocks);
      const rt = roundtrip(doc);
      const exp = dropEmptyTop(doc);
      const serialized = JSON.stringify(serializeMarkdown(doc));

      if (!rt.eq(exp)) throw new Error(`Round-trip failed at iteration ${i} (seed ${SEED}).\n` +
          `Serialized: ${serialized}\n` +
          `Round-trip: ${rt.toString()}\n` +
          `Expected: ${exp.toString()}`);
    }
  });
});
