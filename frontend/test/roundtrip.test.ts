import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseMarkdown } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';
import { words, dropEmptyTop, readFixture } from './helpers';

const fixturesDir = path.join(process.cwd(), 'test', 'fixtures');
const normalizeDir = path.join(process.cwd(), 'test', 'normalize');

// ─── 1. Fixture round-trip: serialize(parse(text)) === text ───────────────────

describe('fixtures: byte-identical round trip', () => {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    it(`serialize(parse(${file})) === text`, () => {
      const text = readFixture(`fixtures/${file}`);
      const { doc } = parseMarkdown(text);
      expect(serializeMarkdown(doc)).toBe(text);
    });
  }
});

// ─── 2. Normalize pairs: serialize(parse(in)) === out, words equal ────────────

describe('normalize pairs', () => {
  const inFiles = fs
    .readdirSync(normalizeDir)
    .filter((f) => f.endsWith('.in.md'));

  for (const inFile of inFiles) {
    const name = inFile.replace(/\.in\.md$/, '');
    it(`${name}: serialize(parse(in)) === out`, () => {
      const input = readFixture(`normalize/${name}.in.md`);
      const output = readFixture(`normalize/${name}.out.md`);
      const { doc: inDoc } = parseMarkdown(input);
      expect(serializeMarkdown(inDoc)).toBe(output);
    });

    it(`${name}: words(in) === words(out)`, () => {
      const input = readFixture(`normalize/${name}.in.md`);
      const output = readFixture(`normalize/${name}.out.md`);
      const { doc: inDoc } = parseMarkdown(input);
      const { doc: outDoc } = parseMarkdown(output);
      expect(words(inDoc)).toEqual(words(outDoc));
    });
  }

  it('crlf-bom: BOM + CRLF input serialises to original', () => {
    const original = readFixture('fixtures/basic-text.md');
    const crlfBom = '\uFEFF' + original.replace(/\n/g, '\r\n');
    const { doc } = parseMarkdown(crlfBom);
    expect(serializeMarkdown(doc)).toBe(original);
  });
});

// ─── 3. Property: parse(serialize(doc)).eq(doc) after dropping empty paras ────

describe('property: parse(serialize(doc)) equals doc', () => {
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    it(file, () => {
      const text = readFixture(`fixtures/${file}`);
      const { doc } = parseMarkdown(text);
      const serialized = serializeMarkdown(doc);
      const { doc: again } = parseMarkdown(serialized);

      const a = dropEmptyTop(again);
      const b = dropEmptyTop(doc);

      if (!a.eq(b)) {
        throw new Error(
          `Property check failed for ${file}.\n` +
          `--- Original doc ---\n${b.toString()}\n` +
          `--- Re-parsed doc ---\n${a.toString()}`,
        );
      }
    });
  }
});

// ─── 4. Parse never throws ────────────────────────────────────────────────────

describe('parse never throws', () => {
  const nasty: string[] = [
    '',
    '{{',
    ':::',
    '::: teacher',
    '<!--',
    '| a |',
    '---\n',
    '\u0000',
  ];

  for (const s of nasty) {
    it(`does not throw for ${JSON.stringify(s)}`, () => {
      const { doc } = parseMarkdown(s);
      expect(() => serializeMarkdown(doc)).not.toThrow();
    });
  }
});
