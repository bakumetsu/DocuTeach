import { describe, expect, it } from 'vitest';
import { createMd } from '../src/markdown/md';
import type { Token } from 'markdown-it';

function parse(src: string) {
  const env: { warnings?: string[] } = {};
  const tokens = createMd().parse(src, env);
  return { tokens, env };
}

function types(tokens: Token[]): string[] {
  return tokens.map((t) => t.type);
}

function inlineText(tokens: Token[]): string {
  return tokens
    .filter((t) => t.type === 'inline')
    .flatMap((t) => t.children ?? [])
    .filter((c) => c.type === 'text' && c.content !== '')
    .map((c) => c.content)
    .join('');
}

describe('div block rule', () => {
  it('parses a teacher note with a tag', () => {
    const { tokens } = parse('::: teacher {tag="note"}\nhello\n:::\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'teacher_close',
    ]);
    expect(tokens[0].meta).toEqual({ tag: 'note' });
    expect(inlineText(tokens)).toBe('hello');
  });

  it('parses a teacher note without a tag', () => {
    const { tokens } = parse('::: teacher\nhello\n:::\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'teacher_close',
    ]);
    expect(tokens[0].meta).toEqual({ tag: '' });
  });

  it('parses a teacher tag containing an escaped quote', () => {
    const { tokens } = parse('::: teacher {tag="a\\"b"}\nhello\n:::\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'teacher_close',
    ]);
    expect(tokens[0].meta).toEqual({ tag: 'a"b' });
  });

  it('parses an empty teacher tag', () => {
    const { tokens } = parse('::: teacher {tag=""}\nhello\n:::\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'teacher_close',
    ]);
    expect(tokens[0].meta).toEqual({ tag: '' });
  });

  it('tokenizes a bullet list inside a teacher note', () => {
    const { tokens } = parse('::: teacher\n- a\n- b\n:::\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'bullet_list_open',
      'list_item_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'list_item_close',
      'list_item_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'list_item_close',
      'bullet_list_close',
      'teacher_close',
    ]);
  });

  it('parses an alignment block wrapping a paragraph', () => {
    const { tokens } = parse('::: {.center}\nhello\n:::\n');

    expect(types(tokens)).toEqual([
      'align_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'align_close',
    ]);
    expect(tokens[0].meta).toEqual({ align: 'center' });
  });

  it('parses an alignment block inside a teacher note with correct close counting', () => {
    const { tokens } = parse('::: teacher\n::: {.center}\nhello\n:::\n:::\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'align_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'align_close',
      'teacher_close',
    ]);
  });

  it('turns an unknown div into one raw block with verbatim content', () => {
    const { tokens } = parse('::: box\nfoo\n:::\n');

    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('::: box\nfoo\n:::');
  });

  it('records a warning and closes an unclosed teacher note at end of input', () => {
    const { tokens, env } = parse('::: teacher\nhello\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'teacher_close',
    ]);
    expect(env.warnings).toEqual(['Unclosed teacher note runs to the end of the file']);
  });

  it('keeps a teacher opener inside a teacher note as paragraph text', () => {
    const { tokens } = parse('::: teacher\n::: teacher\n:::\n');

    expect(types(tokens)).toEqual([
      'teacher_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'teacher_close',
    ]);
    expect(inlineText(tokens)).toBe('::: teacher');
  });

  it('leaves a stray bare ::: as a paragraph', () => {
    const { tokens } = parse(':::\n');

    expect(types(tokens)).toEqual(['paragraph_open', 'inline', 'paragraph_close']);
    expect(inlineText(tokens)).toBe(':::');
  });

  it('parses right and justify alignment blocks', () => {
    const right = parse('::: {.right}\nhello\n:::\n');
    expect(types(right.tokens)).toEqual([
      'align_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'align_close',
    ]);
    expect(right.tokens[0].meta).toEqual({ align: 'right' });

    const justify = parse('::: {.justify}\nhello\n:::\n');
    expect(types(justify.tokens)).toEqual([
      'align_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'align_close',
    ]);
    expect(justify.tokens[0].meta).toEqual({ align: 'justify' });
  });

  it('records a warning for an unclosed alignment block', () => {
    const { tokens, env } = parse('::: {.center}\nhello\n');

    expect(types(tokens)).toEqual([
      'align_open',
      'paragraph_open',
      'inline',
      'paragraph_close',
      'align_close',
    ]);
    expect(env.warnings).toEqual(['Unclosed alignment block']);
  });

  it('keeps an unknown unclosed div as a raw block through end of input', () => {
    const { tokens, env } = parse('::: box\nfoo\n');

    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('::: box\nfoo');
    expect(env.warnings).toEqual(['Unclosed block']);
  });

  it('counts alignment openers when finding the close of an unknown raw div', () => {
    const { tokens } = parse('::: box\n::: {.center}\nfoo\n:::\n:::\n');

    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('::: box\n::: {.center}\nfoo\n:::\n:::');
  });
});
