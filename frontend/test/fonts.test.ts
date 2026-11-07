import { describe, it, expect } from 'vitest';
import type { Node as PMNode, Mark } from '@tiptap/pm/model';
import type { Token } from 'markdown-it';
import { createMd } from '../src/markdown/md';
import { parseMarkdown, parseFragment } from '../src/markdown/parse';
import { serializeMarkdown } from '../src/markdown/serialize';
import { projectStudent } from '../src/editor/project';

const md = createMd();

function inline(src: string) {
  return (md.parseInline(src, {})[0].children ?? []).filter(
    (t: Token) => !(t.type === 'text' && t.content === '')
  );
}

describe('fonts', () => {
  // ── (a) Span rule table ────────────────────────────────────────────────
  describe('(a) span rule table', () => {
    const validCases: [string, Record<string, string | number | string[]>][] = [
      ['[x]{font="Roboto"}', { classes: [], font: 'Roboto' }],
      ['[x]{size=14}', { classes: [], size: 14 }],
      ['[x]{font="Be Vietnam Pro" size=28}', { classes: [], font: 'Be Vietnam Pro', size: 28 }],
      ['[x]{size=10.5}', { classes: [], size: 10.5 }],
      ['[x]{size=6}', { classes: [], size: 6 }],
      ['[x]{size=72}', { classes: [], size: 72 }],
      ['[x]{.u font="Roboto"}', { classes: ['u'], font: 'Roboto' }],
      ['[x]{size=14 .u}', { classes: ['u'], size: 14 }],
      ['[x]{font="Tiếng Việt"}', { classes: [], font: 'Tiếng Việt' }],
    ];

    for (const [src, expectedMeta] of validCases) {
      it(`valid: ${src}`, () => {
        const tokens = inline(src);
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens[0].type).toBe('span_open');
        expect(tokens[0].meta).toEqual(expectedMeta);
      });
    }

    const invalidCases: string[] = [
      '[x]{font=Roboto}',
      '[x]{font="A" size=999}',
      '[x]{size=13.3}',
      '[x]{size=5}',
      '[x]{size=72.5}',
      '[x]{size=big}',
      '[x]{color=red}',
      '[x]{.foo}',
      '[x]{font="A" font="B"}',
      '[x]{size=10 size=12}',
      '[x]{}',
      '[x]{font=""}',
      `[x]{font="${'A'.repeat(41)}"}`,
      '[x]{font="a;b"}',
      '[x]{font="a(b)"}',
      '[x]{font="a:b"}',
      '[x]{font="a/b"}',
      '[x]{font="a\'b"}',
      '[x]{font="a\\b"}',
    ];

    for (const src of invalidCases) {
      it(`invalid (literal): ${src}`, () => {
        const tokens = inline(src);
        expect(tokens.find((t: Token) => t.type === 'span_open')).toBeUndefined();
      });
    }
  });

  // ── (b) Hostile names ──────────────────────────────────────────────────
  describe('(b) hostile names', () => {
    const hostileNames = [
      'x;background:url(http://a)',
      'a"b',
      '}{',
      '<img src=x>',
    ];

    for (const name of hostileNames) {
      it(`no fontStyle for hostile name: ${name}`, () => {
        const source = `[t]{font="${name}"}`;
        const parsed = parseMarkdown(source);
        let found = false;
        parsed.doc.descendants((node: PMNode) => {
          if (node.marks?.some((m: Mark) => m.type.name === 'fontStyle')) {
            found = true;
          }
        });
        expect(found).toBe(false);
        const serialized = serializeMarkdown(parsed.doc);
        expect(serialized).not.toContain('style=');
      });
    }
  });

  // ── (c) Literal text ───────────────────────────────────────────────────
  it('(c) escaped bracket is literal text, no fontStyle mark', () => {
    const parsed = parseMarkdown('Not a span: \\[x\\]{size=14}');
    let found = false;
    parsed.doc.descendants((node: PMNode) => {
      if (node.marks?.some((m: Mark) => m.type.name === 'fontStyle')) {
        found = true;
      }
    });
    expect(found).toBe(false);
  });

  // ── (d) MCQ ────────────────────────────────────────────────────────────
  it('(d) - [x]{size=14} text is a bulletList, not mcq, round-trips', () => {
    const s = '- [x]{size=14} text\n';
    const parsed = parseMarkdown(s);

    // No node named 'mcq' anywhere
    let foundMcq = false;
    parsed.doc.descendants((node: PMNode) => {
      if (node.type.name === 'mcq') foundMcq = true;
    });
    expect(foundMcq).toBe(false);

    // Top-level node is a bulletList
    expect(parsed.doc.firstChild?.type.name).toBe('bulletList');

    // Round-trip: serializer output ends with '\n', s already does
    expect(serializeMarkdown(parsed.doc)).toBe(s);
  });

  // ── (e) Canonical names ────────────────────────────────────────────────
  describe('(e) canonical names', () => {
    it('lowercase "roboto" serializes as "Roboto"', () => {
      const s = '[x]{font="roboto"}\n';
      const out = serializeMarkdown(parseMarkdown(s).doc);
      expect(out).toContain('[x]{font="Roboto"}');
    });

    it('unlisted "Comic Sans MS" is kept verbatim', () => {
      const s = '[x]{font="Comic Sans MS"}\n';
      const out = serializeMarkdown(parseMarkdown(s).doc);
      expect(out).toContain('[x]{font="Comic Sans MS"}');
    });

    it('size 10.5 is preserved', () => {
      const s = '[x]{size=10.5}\n';
      const out = serializeMarkdown(parseMarkdown(s).doc);
      expect(out).toContain('[x]{size=10.5}');
    });
  });

  // ── (f) stripFontStyle ─────────────────────────────────────────────────
  describe('(f) stripFontStyle', () => {
    const source =
      'We use [Present Perfect]{font="Merriweather" size=14} for {{ans}} and [{{b}}]{size=16}.';

    function hasFontStyle(node: PMNode): boolean {
      if (node.marks?.some((m) => m.type.name === 'fontStyle')) return true;
      let found = false;
      node.descendants((child) => {
        if (child.marks?.some((m) => m.type.name === 'fontStyle')) found = true;
      });
      return found;
    }

    it('with stripStyle:true, no fontStyle mark anywhere', () => {
      const { nodes } = parseFragment(source, { stripStyle: true });
      let found = false;
      for (const n of nodes) {
        if (hasFontStyle(n)) { found = true; break; }
      }
      expect(found).toBe(false);

      // Text content still contains "Present Perfect"
      let text = '';
      for (const n of nodes) {
        if (n.isText) text += n.text ?? '';
        n.descendants((child) => {
          if (child.isText) text += child.text ?? '';
        });
      }
      expect(text).toContain('Present Perfect');
    });

    it('without stripStyle, fontStyle mark IS present', () => {
      const { nodes } = parseFragment(source);
      let found = false;
      for (const n of nodes) {
        if (hasFontStyle(n)) { found = true; break; }
      }
      expect(found).toBe(true);
    });
  });

  // ── (g) projectStudent keeps style, drops notes ────────────────────────
  describe('(g) projectStudent', () => {
    it('keeps fontStyle, drops teacher notes', () => {
      const mdSource =
        '[Student text]{font="Roboto" size=14}\n\n' +
        '::: teacher {tag="T"}\n' +
        'ZZ-FONT-9 [secret]{font="Merriweather"}\n' +
        ':::';
      const parsed = parseMarkdown(mdSource);
      const student = projectStudent(parsed.doc);

      // Still has a fontStyle mark with font 'Roboto'
      let foundRoboto = false;
      student.descendants((node: PMNode) => {
        for (const mark of node.marks ?? []) {
          if (mark.type.name === 'fontStyle' && mark.attrs?.font === 'Roboto') {
            foundRoboto = true;
          }
        }
      });
      expect(foundRoboto).toBe(true);

      const serialized = serializeMarkdown(student);
      expect(serialized).not.toContain('ZZ-FONT-9');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('Merriweather');
    });

    it('styled blank keeps mark, answers cleared, label removed', () => {
      const mdSource = '[{{ANSWERX}}]{size=16}';
      const parsed = parseMarkdown(mdSource);
      const student = projectStudent(parsed.doc);

      let foundBlank = false;
      student.descendants((node: PMNode) => {
        if (node.type.name === 'blank') {
          foundBlank = true;
          expect(node.attrs?.answers).toEqual([]);
          const fsMark = (node.marks ?? []).find((m: Mark) => m.type.name === 'fontStyle');
          expect(fsMark).toBeDefined();
          expect(fsMark?.attrs?.size).toBe(16);
        }
      });
      expect(foundBlank).toBe(true);

      const serialized = serializeMarkdown(student);
      expect(serialized).not.toContain('ANSWERX');
    });
  });
});
