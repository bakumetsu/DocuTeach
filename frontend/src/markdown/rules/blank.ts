import type { MarkdownIt as MarkdownItType, StateInline, Token } from 'markdown-it';

/**
 * Returns true if the character at `pos` is escaped,
 * i.e. preceded by an odd number of backslashes.
 */
function isEscaped(src: string, pos: number): boolean {
  let count = 0;
  let i = pos - 1;
  while (i >= 0 && src[i] === '\\') {
    count++;
    i--;
  }
  return count % 2 === 1;
}

/**
 * Remove backslash escapes for `\`, `|`, `}`.
 * A backslash before any other character is kept.
 */
function unescape(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (
      s[i] === '\\' &&
      i + 1 < s.length &&
      (s[i + 1] === '\\' || s[i + 1] === '|' || s[i + 1] === '}')
    ) {
      out += s[i + 1];
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

/**
 * Split `inner` on unescaped `|` characters.
 * A `|` preceded by an odd number of backslashes is not a separator.
 */
function splitUnescapedPipe(inner: string): string[] {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '|' && !isEscaped(inner, i)) {
      parts.push(cur);
      cur = '';
    } else {
      cur += inner[i];
    }
  }
  parts.push(cur);
  return parts;
}

function blankRule(state: StateInline, silent: boolean): boolean {
  // Must start with {{
  if (
    state.src[state.pos] !== '{' ||
    state.pos + 1 >= state.posMax ||
    state.src[state.pos + 1] !== '{'
  ) {
    return false;
  }

  const start = state.pos;
  let i = state.pos + 2;

  // Scan for closing }} on the same line
  let end = -1;
  while (i < state.posMax) {
    if (state.src[i] === '\n') break; // no newline allowed
    if (
      state.src[i] === '}' &&
      i + 1 < state.posMax &&
      state.src[i + 1] === '}' &&
      !isEscaped(state.src, i) &&
      !isEscaped(state.src, i + 1)
    ) {
      end = i;
      break;
    }
    i++;
  }

  if (end === -1) return false;

  if (silent) return true;

  const inner = state.src.slice(start + 2, end);

  // Parse answers
  const rawParts = splitUnescapedPipe(inner);
  const answers: string[] = rawParts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => unescape(p));

  const t: Token = state.push('blank', '', 0);
  t.meta = { answers };

  state.pos = end + 2;
  return true;
}

export function blankPlugin(md: MarkdownItType): void {
  md.inline.ruler.before('escape', 'docuteach_blank', blankRule);
}
