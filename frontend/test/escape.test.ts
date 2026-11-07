import { describe, it, expect } from 'vitest'
import {
  escapeInline,
  escapeLineStart,
  escapeAnswer,
  unescapeAnswer,
  escapeTag,
  unescapeTag,
  escapeCellPipes,
} from '../src/markdown/escape'

describe('escapeInline', () => {
  it('escapes underscore between word characters', () => {
    expect(escapeInline('a_b')).toBe('a\\_b')
  })

  it('leaves a full-line underscore run alone (string edge both sides)', () => {
    expect(escapeInline('______')).toBe('______')
  })

  it('leaves an underscore run with whitespace on both sides alone', () => {
    expect(escapeInline('a ______ b')).toBe('a ______ b')
  })

  it('escapes asterisks always', () => {
    expect(escapeInline('**x**')).toBe('\\*\\*x\\*\\*')
  })

  it('escapes double opening brace', () => {
    expect(escapeInline('{{')).toBe('\\{{')
  })

  it('escapes a run of two equals signs', () => {
    expect(escapeInline('a == b')).toBe('a \\=\\= b')
  })

  it('escapes < before a letter', () => {
    expect(escapeInline('a<b')).toBe('a\\<b')
  })

  it('escapes < at start before a letter, leaves > alone', () => {
    expect(escapeInline('<b>')).toBe('\\<b>')
  })

  it('escapes & before a named entity', () => {
    expect(escapeInline('AT&amp;T')).toBe('AT\\&amp;T')
  })

  it('does not escape & followed by a space', () => {
    expect(escapeInline('AT & T')).toBe('AT & T')
  })

  it('escapes backslash first', () => {
    expect(escapeInline('a\\b')).toBe('a\\\\b')
  })

  it('escapes square brackets', () => {
    expect(escapeInline('[x]')).toBe('\\[x\\]')
  })

  it('escapes backtick', () => {
    expect(escapeInline('`code`')).toBe('\\`code\\`')
  })

  it('escapes __x__ (edge on one side only)', () => {
    expect(escapeInline('__x__')).toBe('\\_\\_x\\_\\_')
  })
})

describe('escapeLineStart', () => {
  it('escapes # at line start', () => {
    expect(escapeLineStart('# x', false)).toBe('\\# x')
  })

  it('escapes - at line start', () => {
    expect(escapeLineStart('- x', false)).toBe('\\- x')
  })

  it('escapes ::: at line start', () => {
    expect(escapeLineStart('::: x', false)).toBe('\\::: x')
  })

  it('escapes digit-dot at line start (backslash before the dot)', () => {
    expect(escapeLineStart('1. x', false)).toBe('1\\. x')
  })

  it('escapes digit-paren at line start (backslash before the paren)', () => {
    expect(escapeLineStart('2) x', false)).toBe('2\\) x')
  })

  it('leaves a plain line unchanged', () => {
    expect(escapeLineStart('plain', false)).toBe('plain')
  })

  it('escapes --- whole line (3+ dashes)', () => {
    expect(escapeLineStart('---', true)).toBe('\\---')
  })

  it('escapes ______ whole line (3+ underscores)', () => {
    expect(escapeLineStart('______', true)).toBe('\\______')
  })

  it('does not escape a line with fewer than 3 dashes even with wholeLine', () => {
    expect(escapeLineStart('--', true)).toBe('\\--')
  })

  it('escapes > at line start', () => {
    expect(escapeLineStart('> x', false)).toBe('\\> x')
  })

  it('escapes + at line start', () => {
    expect(escapeLineStart('+ x', false)).toBe('\\+ x')
  })
})

describe('escapeCellPipes', () => {
  it('escapes pipes outside blanks, leaves pipes inside blanks untouched', () => {
    expect(escapeCellPipes('a | b {{x\\|y | z}}')).toBe('a \\| b {{x\\|y | z}}')
  })

  it('escapes a lone pipe', () => {
    expect(escapeCellPipes('a|b')).toBe('a\\|b')
  })

  it('leaves content inside a blank with escaped pipe untouched', () => {
    expect(escapeCellPipes('{{a\\|b}}')).toBe('{{a\\|b}}')
  })

  it('handles multiple blanks', () => {
    expect(escapeCellPipes('| {{a|b}} | {{c|d}} |')).toBe('\\| {{a|b}} \\| {{c|d}} \\|')
  })
})

describe('escapeAnswer / unescapeAnswer', () => {
  it('round-trips a|b}c\\d', () => {
    const original = 'a|b}c\\d'
    const escaped = escapeAnswer(original)
    expect(escaped).toBe('a\\|b\\}c\\\\d')
    expect(unescapeAnswer(escaped)).toBe(original)
  })

  it('escapes backslash, pipe, and closing brace', () => {
    expect(escapeAnswer('\\|}')).toBe('\\\\\\|\\}')
  })
})

describe('escapeTag / unescapeTag', () => {
  it('round-trips a tag with quote and backslash', () => {
    const original = 'say "hi" \\ there'
    const escaped = escapeTag(original)
    expect(escaped).toBe('say \\"hi\\" \\\\ there')
    expect(unescapeTag(escaped)).toBe(original)
  })

  it('escapes double quote', () => {
    expect(escapeTag('a"b')).toBe('a\\"b')
  })
})
