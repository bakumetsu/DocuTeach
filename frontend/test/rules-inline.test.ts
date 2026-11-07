import { describe, it, expect } from 'vitest';
import type { Token } from 'markdown-it';
import { createMd } from '../src/markdown/md';

const md = createMd();

function parse(src: string): Token[] {
  const tokens = md.parseInline(src, {});
  return (tokens[0].children ?? []).filter(
    (t) => !(t.type === 'text' && t.content === ''),
  );
}

function textOf(tokens: Token[]): string {
  return tokens
    .filter((t) => t.type === 'text')
    .map((t) => t.content)
    .join('');
}

describe('blank rule', () => {
  it('{{you}} -> one blank token with answers ["you"]', () => {
    const children = parse('{{you}}');
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('blank');
    expect(children[0].meta).toEqual({ answers: ['you'] });
  });

  it("{{has lived | 's lived}} -> 2 answers", () => {
    const children = parse("{{has lived | 's lived}}");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('blank');
    expect(children[0].meta).toEqual({ answers: ["has lived", "'s lived"] });
  });

  it('{{ a|b }} -> ["a","b"]', () => {
    const children = parse('{{ a|b }}');
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('blank');
    expect(children[0].meta).toEqual({ answers: ['a', 'b'] });
  });

  it('{{a\\|b}} -> ["a|b"]', () => {
    const children = parse('{{a\\|b}}');
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('blank');
    expect(children[0].meta).toEqual({ answers: ['a|b'] });
  });

  it('{{c\\}d}} -> ["c}d"]', () => {
    const children = parse('{{c\\}d}}');
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('blank');
    expect(children[0].meta).toEqual({ answers: ['c}d'] });
  });

  it('{{e\\f}} -> ["e\\\\f"]', () => {
    const children = parse('{{e\\f}}');
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('blank');
    expect(children[0].meta).toEqual({ answers: ['e\\f'] });
  });

  it('{{}} -> answers []', () => {
    const children = parse('{{}}');
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('blank');
    expect(children[0].meta).toEqual({ answers: [] });
  });

  it('{{unclosed -> no blank token, text is literal', () => {
    const children = parse('{{unclosed');
    expect(children.some((t) => t.type === 'blank')).toBe(false);
    expect(textOf(children)).toBe('{{unclosed');
  });

  it('\\{{x}} -> no blank token, text is {{x}}', () => {
    const children = parse('\\{{x}}');
    expect(children.some((t) => t.type === 'blank')).toBe(false);
    expect(textOf(children)).toBe('{{x}}');
  });

  it('blank inside bold **{{x}}**', () => {
    const children = parse('**{{x}}**');
    expect(children.map((t) => t.type)).toEqual(['strong_open', 'blank', 'strong_close']);
    expect(children[1].meta).toEqual({ answers: ['x'] });
  });
});

describe('span rule', () => {
  it('[t]{.u} -> span_open, text, span_close', () => {
    const children = parse('[t]{.u}');
    expect(children.map((t) => t.type)).toEqual(['span_open', 'text', 'span_close']);
    expect(children[0].meta).toEqual({ classes: ['u'] });
    expect(children[1].content).toBe('t');
  });

  it('[t]{.u .b} -> span_open with classes ["u","b"], text, span_close', () => {
    const children = parse('[t]{.u .b}');
    expect(children.map((t) => t.type)).toEqual(['span_open', 'text', 'span_close']);
    expect(children[0].meta).toEqual({ classes: ['u', 'b'] });
    expect(children[1].content).toBe('t');
  });

  it('[t]{.foo} -> no span token, text remains literal', () => {
    const children = parse('[t]{.foo}');
    expect(children.some((t) => t.type === 'span_open')).toBe(false);
    expect(textOf(children)).toBe('[t]{.foo}');
  });

  it('[==both==]{.u} -> span_open, mark_open, text, mark_close, span_close', () => {
    const children = parse('[==both==]{.u}');
    expect(children.map((t) => t.type)).toEqual([
      'span_open',
      'mark_open',
      'text',
      'mark_close',
      'span_close',
    ]);
    expect(children[0].meta).toEqual({ classes: ['u'] });
    expect(children[2].content).toBe('both');
  });
});

describe('mark rule', () => {
  it('==hi== -> mark_open, text, mark_close', () => {
    const children = parse('==hi==');
    expect(children.map((t) => t.type)).toEqual(['mark_open', 'text', 'mark_close']);
    expect(children[1].content).toBe('hi');
  });

  it('== hi== -> literal text', () => {
    const children = parse('== hi==');
    expect(children.some((t) => t.type === 'mark_open')).toBe(false);
    expect(textOf(children)).toBe('== hi==');
  });

  it('\\=\\=x\\=\\= -> literal text ==x==', () => {
    const children = parse('\\=\\=x\\=\\=');
    expect(children.some((t) => t.type === 'mark_open')).toBe(false);
    expect(textOf(children)).toBe('==x==');
  });
});
