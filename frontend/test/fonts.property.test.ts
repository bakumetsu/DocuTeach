import { describe, it } from 'vitest';
import type { Node as PMNode, Mark } from '@tiptap/pm/model';
import { parseMarkdown } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';
import { schema } from '../src/editor/extensions';
import { dropEmptyTop } from './helpers';

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('fonts round-trip (deterministic property)', () => {
  it('300 seeded documents round-trip through serialize→parse', () => {
    const pool = ['alpha', 'beta', 'Thì đã', 'x', 'Note:', 'one two'];
    const blankAnswers = ['a', 'b c'];
    const styles: (Record<string, string | number> | null)[] = [
      null,
      { font: 'Roboto' },
      { size: 14 },
      { font: 'Merriweather', size: 16 },
      { font: 'Comic Sans MS', size: 10.5 },
    ];
    const extraMarks: (string | null)[] = [null, 'bold', 'italic', 'underline', 'highlight'];

    for (let seed = 1; seed <= 300; seed++) {
      const rng = mulberry32(seed);
      const pieceCount = 1 + Math.floor(rng() * 5); // 1–5 pieces
      const nodes: PMNode[] = [];

      for (let i = 0; i < pieceCount; i++) {
        // Plain unstyled ' ' separator between consecutive pieces
        if (i > 0) {
          nodes.push(schema.text(' '));
        }

        const isBlank = rng() < 0.5;
        const style = styles[Math.floor(rng() * styles.length)];
        const marks: Mark[] = [];

        if (style) {
          marks.push(
            schema.marks.fontStyle.create({
              font: style.font ?? null,
              size: style.size ?? null,
            })
          );
        }

        if (isBlank) {
          // Blanks carry only the fontStyle mark
          const answer = blankAnswers[Math.floor(rng() * blankAnswers.length)];
          nodes.push(schema.nodes.blank.create({ answers: [answer] }, null, marks));
        } else {
          // Text piece: fontStyle + optionally one of bold/italic/underline/highlight
          const text = pool[Math.floor(rng() * pool.length)];
          const extra = extraMarks[Math.floor(rng() * extraMarks.length)];
          if (extra) {
            marks.push(schema.marks[extra].create());
          }
          nodes.push(schema.text(text, marks));
        }
      }

      const paragraph = schema.nodes.paragraph.create({ align: 'left' }, nodes);
      const doc = schema.nodes.doc.create({ meta: { raw: '', data: null, broken: false } }, [paragraph]);

      const serialized = serializeMarkdown(doc);
      const reparsed = dropEmptyTop(parseMarkdown(serialized).doc);
      const original = dropEmptyTop(doc);

      if (!reparsed.eq(original)) {
        throw new Error(
          `Round-trip mismatch (seed ${seed})\n` +
          `Serialized:\n${serialized}\n\n` +
          `Original JSON:\n${JSON.stringify(doc.toJSON(), null, 2)}\n\n` +
          `Reparsed JSON:\n${JSON.stringify(reparsed.toJSON(), null, 2)}`
        );
      }
    }
  });
});
