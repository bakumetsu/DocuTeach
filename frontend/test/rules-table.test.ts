import { describe, it, expect } from 'vitest';
import { createMd } from '../src/markdown/md';
import { splitRow } from '../src/markdown/rules/table';

const md = createMd();

function types(tokens: { type: string }[]): string[] {
  return tokens.map((t) => t.type);
}

describe('table rule', () => {
  it('simple 2x2 with a body row', () => {
    const src = '| a | b |\n| - | - |\n| c | d |\n';
    const tokens = md.parse(src, {});
    expect(types(tokens)).toEqual([
      'table_open',
      'thead_open',
      'tr_open',
      'th_open',
      'inline',
      'th_close',
      'th_open',
      'inline',
      'th_close',
      'tr_close',
      'thead_close',
      'tbody_open',
      'tr_open',
      'td_open',
      'inline',
      'td_close',
      'td_open',
      'inline',
      'td_close',
      'tr_close',
      'tbody_close',
      'table_close',
    ]);
    // Check inline contents
    const inlines = tokens.filter((t) => t.type === 'inline');
    expect(inlines[0].content).toBe('a');
    expect(inlines[1].content).toBe('b');
    expect(inlines[2].content).toBe('c');
    expect(inlines[3].content).toBe('d');
  });

  it('blanks in cells', () => {
    const src = '| {{x}} | {{y}} |\n| - | - |\n| {{z}} | w |\n';
    const tokens = md.parse(src, {});
    expect(types(tokens)).toEqual([
      'table_open',
      'thead_open',
      'tr_open',
      'th_open',
      'inline',
      'th_close',
      'th_open',
      'inline',
      'th_close',
      'tr_close',
      'thead_close',
      'tbody_open',
      'tr_open',
      'td_open',
      'inline',
      'td_close',
      'td_open',
      'inline',
      'td_close',
      'tr_close',
      'tbody_close',
      'table_close',
    ]);
    const inlines = tokens.filter((t) => t.type === 'inline');
    expect(inlines[0].content).toBe('{{x}}');
    expect(inlines[1].content).toBe('{{y}}');
    expect(inlines[2].content).toBe('{{z}}');
    expect(inlines[3].content).toBe('w');
  });

  it('{{has lived | \'s lived}} stays one cell with blank token in inline children', () => {
    const src = "| {{has lived | 's lived}} |\n| - |\n| ok |\n";
    const tokens = md.parse(src, {});
    // The header should be a single cell (the pipe inside the blank is not a separator)
    const inlines = tokens.filter((t) => t.type === 'inline');
    expect(inlines.length).toBe(2); // header cell + body cell
    expect(inlines[0].content).toBe("{{has lived | 's lived}}");
    // After md.parse, the inline rule fills children
    const children = inlines[0].children!;
    const blankToken = children.find((c) => c.type === 'blank');
    expect(blankToken).toBeDefined();
    expect(blankToken!.meta).toEqual({ answers: ['has lived', "'s lived"] });
  });

  it('{{a\\|b}} cell produces answers [\'a|b\']', () => {
    const src = '| {{a\\|b}} |\n| - |\n| x |\n';
    const tokens = md.parse(src, {});
    const inlines = tokens.filter((t) => t.type === 'inline');
    expect(inlines[0].content).toBe('{{a\\|b}}');
    const children = inlines[0].children!;
    const blankToken = children.find((c) => c.type === 'blank');
    expect(blankToken).toBeDefined();
    expect(blankToken!.meta).toEqual({ answers: ['a|b'] });
  });

  it('\\| outside a blank gives a text with a literal |', () => {
    const src = '| a \\| b |\n| - |\n| x |\n';
    const tokens = md.parse(src, {});
    const inlines = tokens.filter((t) => t.type === 'inline');
    expect(inlines[0].content).toBe('a | b');
    // The inline children should contain a text token with the literal pipe
    const textChild = inlines[0].children!.find((c) => c.type === 'text');
    expect(textChild).toBeDefined();
    expect(textChild!.content).toBe('a | b');
  });

  it('marks in cells produce strong_open child', () => {
    const src = '| **bold** | x |\n| - | - |\n| y | z |\n';
    const tokens = md.parse(src, {});
    const inlines = tokens.filter((t) => t.type === 'inline');
    const headerFirst = inlines[0];
    expect(headerFirst.content).toBe('**bold**');
    const children = headerFirst.children!;
    expect(children.some((c) => c.type === 'strong_open')).toBe(true);
  });

  it('a row with too few cells is padded', () => {
    const src = '| a | b | c |\n| - | - | - |\n| 1 | 2 |\n';
    const tokens = md.parse(src, {});
    const inlines = tokens.filter((t) => t.type === 'inline');
    // 3 header + 3 body (padded) = 6 inlines
    expect(inlines.length).toBe(6);
    expect(inlines[3].content).toBe('1');
    expect(inlines[4].content).toBe('2');
    expect(inlines[5].content).toBe('');
  });

  it('table ends at a blank line and a following paragraph is parsed', () => {
    const src = '| a | b |\n| - | - |\n| c | d |\n\npara after\n';
    const tokens = md.parse(src, {});
    expect(types(tokens)).toEqual([
      'table_open',
      'thead_open',
      'tr_open',
      'th_open',
      'inline',
      'th_close',
      'th_open',
      'inline',
      'th_close',
      'tr_close',
      'thead_close',
      'tbody_open',
      'tr_open',
      'td_open',
      'inline',
      'td_close',
      'td_open',
      'inline',
      'td_close',
      'tr_close',
      'tbody_close',
      'table_close',
      'paragraph_open',
      'inline',
      'paragraph_close',
    ]);
    const lastInline = tokens.filter((t) => t.type === 'inline').pop()!;
    expect(lastInline.content).toBe('para after');
  });

  it('header without alignment row is NOT a table', () => {
    const src = '| a | b |\n';
    const tokens = md.parse(src, {});
    expect(tokens[0].type).toBe('paragraph_open');
    expect(tokens[1].type).toBe('inline');
    expect(tokens[1].content).toBe('| a | b |');
  });

  it('alignment cell count mismatch is not a table', () => {
    const src = '| a | b |\n| - |\n';
    const tokens = md.parse(src, {});
    expect(tokens[0].type).toBe('paragraph_open');
  });

  it('leading/trailing pipes optional', () => {
    const src = 'a | b\n- | -\nc | d\n';
    const tokens = md.parse(src, {});
    expect(types(tokens)).toEqual([
      'table_open',
      'thead_open',
      'tr_open',
      'th_open',
      'inline',
      'th_close',
      'th_open',
      'inline',
      'th_close',
      'tr_close',
      'thead_close',
      'tbody_open',
      'tr_open',
      'td_open',
      'inline',
      'td_close',
      'td_open',
      'inline',
      'td_close',
      'tr_close',
      'tbody_close',
      'table_close',
    ]);
    const inlines = tokens.filter((t) => t.type === 'inline');
    expect(inlines[0].content).toBe('a');
    expect(inlines[1].content).toBe('b');
    expect(inlines[2].content).toBe('c');
    expect(inlines[3].content).toBe('d');
  });

  it('splitRow: basic splitting', () => {
    expect(splitRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
    expect(splitRow('a | b | c')).toEqual(['a', 'b', 'c']);
    expect(splitRow('| a | b')).toEqual(['a', 'b']);
    expect(splitRow('a | b |')).toEqual(['a', 'b']);
  });

  it('splitRow: escaped pipe \\| outside blank', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
    expect(splitRow('a \\| b')).toEqual(['a | b']);
  });

  it('splitRow: escaped backslash then real separator', () => {
    // \\| is an escaped backslash (\\) followed by a real separator |
    // Two backslashes is even, so the pipe is a real separator and both
    // backslashes are left in the cell text for the inline parser.
    const cells = splitRow('| a \\\\| b |');
    expect(cells.length).toBe(2);
    expect(cells[0]).toBe('a \\\\');
    expect(cells[1]).toBe('b');
  });

  it('splitRow: pipe inside blank does not split', () => {
    expect(splitRow('| {{a | b}} | c |')).toEqual(['{{a | b}}', 'c']);
    expect(splitRow('{{x|y}} | z')).toEqual(['{{x|y}}', 'z']);
  });

  it('splitRow: empty cells', () => {
    expect(splitRow('| | |')).toEqual(['', '']);
    expect(splitRow('| a || b |')).toEqual(['a', '', 'b']);
  });
});
