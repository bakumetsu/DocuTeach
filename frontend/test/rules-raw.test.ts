import { describe, it, expect } from 'vitest';
import { createMd } from '../src/markdown/md';
import type { Token } from 'markdown-it';

function parse(src: string): Token[] {
  const md = createMd();
  return md.parse(src, {});
}

function types(tokens: Token[]): string[] {
  return tokens.map((t) => t.type);
}

function inlineTexts(tokens: Token[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.type === 'text' && t.content.trim() !== '') out.push(t.content);
    if (t.children) {
      for (const c of t.children) {
        if (c.type === 'text' && c.content.trim() !== '') out.push(c.content);
      }
    }
  }
  return out;
}

describe('raw rule', () => {
  it('code fence with info string', () => {
    const src = '```js\nconst x = 1;\n```\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('```js\nconst x = 1;\n```');
    expect(tokens[0].map).toEqual([0, 3]);
  });

  it('unclosed fence runs to end of input', () => {
    const src = '```\nline1\nline2\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('```\nline1\nline2');
    expect(tokens[0].map).toEqual([0, 3]);
  });

  it('tilde fence', () => {
    const src = '~~~\ncontent\n~~~\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('~~~\ncontent\n~~~');
    expect(tokens[0].map).toEqual([0, 3]);
  });

  it('~~~~ containing ``` inside', () => {
    const src = '~~~~\n```\n~~~~\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('~~~~\n```\n~~~~');
    expect(tokens[0].map).toEqual([0, 3]);
  });

  it('blockquote of 3 lines then paragraph', () => {
    const src = '> a\n> b\n> c\npara\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block', 'paragraph_open', 'inline', 'paragraph_close']);
    expect(tokens[0].content).toBe('> a\n> b\n> c');
    expect(tokens[0].map).toEqual([0, 3]);
    expect(inlineTexts(tokens)).toContain('para');
  });

  it('*** horizontal rule', () => {
    const src = '***\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('***');
    expect(tokens[0].map).toEqual([0, 1]);
  });

  it('___ horizontal rule', () => {
    const src = '___\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('___');
    expect(tokens[0].map).toEqual([0, 1]);
  });

  it('- - - horizontal rule', () => {
    const src = '- - -\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('- - -');
    expect(tokens[0].map).toEqual([0, 1]);
  });

  it('--- after blank line is a rule, but Title\\n--- is heading h2', () => {
    // --- after blank line → raw_block
    const src1 = '\n---\n';
    const tokens1 = parse(src1);
    expect(types(tokens1)).toEqual(['raw_block']);
    expect(tokens1[0].content).toBe('---');

    // Title\n--- → setext heading (lheading consumes both lines)
    const src2 = 'Title\n---\n';
    const tokens2 = parse(src2);
    expect(types(tokens2)).toEqual(['heading_open', 'inline', 'heading_close']);
    expect(tokens2[0].tag).toBe('h2');
  });

  it('* * * is not a list', () => {
    const src = '* * *\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('* * *');
    expect(tokens[0].map).toEqual([0, 1]);
  });

  it('html block <div>x</div>', () => {
    const src = '<div>x</div>\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('<div>x</div>');
    expect(tokens[0].map).toEqual([0, 1]);
  });

  it('<b>x</b> trailing at line start is raw_block', () => {
    const src = '<b>x</b> trailing\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('<b>x</b> trailing');
    expect(tokens[0].map).toEqual([0, 1]);
  });

  it('paragraph line "a < b" stays paragraph', () => {
    const src = 'a < b\n';
    const tokens = parse(src);
    expect(types(tokens)).toEqual(['paragraph_open', 'inline', 'paragraph_close']);
    expect(inlineTexts(tokens)).toEqual(['a < b']);
  });

  it('html block runs until blank line (exclusive)', () => {
    const src = '<div>\ninner\n\nafter\n';
    const tokens = parse(src);
    // raw_block: <div>\ninner
    // blank line consumed by blankPlugin (or just skipped)
    // paragraph: after
    const rawTokens = tokens.filter((t) => t.type === 'raw_block');
    expect(rawTokens.length).toBe(1);
    expect(rawTokens[0].content).toBe('<div>\ninner');
    expect(rawTokens[0].map).toEqual([0, 2]);
  });
});
