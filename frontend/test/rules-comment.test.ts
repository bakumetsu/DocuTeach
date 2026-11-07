import { describe, it, expect } from 'vitest';
import { createMd } from '../src/markdown/md';

describe('comment rule', () => {
  it('split with default label', () => {
    const md = createMd();
    const tokens = md.parse('<!-- split: -->\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['split_point']);
    expect(tokens[0].meta).toEqual({ label: 'Homework starts here' });
  });

  it('split with custom label', () => {
    const md = createMd();
    const tokens = md.parse('<!-- split: Exam part B -->\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['split_point']);
    expect(tokens[0].meta).toEqual({ label: 'Exam part B' });
  });

  it('empty label gives default', () => {
    const md = createMd();
    const tokens = md.parse('<!-- split:   -->\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['split_point']);
    expect(tokens[0].meta).toEqual({ label: 'Homework starts here' });
  });

  it('no-space form <!--split:X--> works', () => {
    const md = createMd();
    const tokens = md.parse('<!--split:X-->\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['split_point']);
    expect(tokens[0].meta).toEqual({ label: 'X' });
  });

  it('other single-line comment is a raw_block with exact content', () => {
    const md = createMd();
    const tokens = md.parse('<!-- note to self -->\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('<!-- note to self -->');
  });

  it('multi-line comment is one raw_block with all lines', () => {
    const md = createMd();
    const tokens = md.parse('<!-- hello\nworld\n-->\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('<!-- hello\nworld\n-->');
  });

  it('unterminated <!-- runs to end as raw_block', () => {
    const md = createMd();
    const tokens = md.parse('<!-- hello\nworld\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('<!-- hello\nworld');
  });

  it('comment directly after paragraph line splits the paragraph', () => {
    const md = createMd();
    const tokens = md.parse('Some text\n<!-- split: -->\n', {});
    expect(tokens.map((t) => t.type)).toEqual([
      'paragraph_open',
      'inline',
      'paragraph_close',
      'split_point',
    ]);
    expect(tokens[3].meta).toEqual({ label: 'Homework starts here' });
  });

  it('trailing content after --> stays in raw_block', () => {
    const md = createMd();
    const tokens = md.parse('<!-- hello\n--> world\n', {});
    expect(tokens.map((t) => t.type)).toEqual(['raw_block']);
    expect(tokens[0].content).toBe('<!-- hello\n--> world');
  });
});
