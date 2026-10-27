import type { MarkdownIt as MarkdownItType, StateInline } from 'markdown-it';

function isWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function markRule(state: StateInline, silent: boolean): boolean {
  if (
    state.src[state.pos] !== '=' ||
    state.pos + 1 >= state.posMax ||
    state.src[state.pos + 1] !== '='
  ) {
    return false;
  }

  // Next char after == must not be whitespace or =
  const next = state.src[state.pos + 2];
  if (next === undefined || next === '=' || isWhitespace(next)) return false;

  // Find closing ==
  let i = state.pos + 2;
  while (i + 1 < state.posMax) {
    if (state.src[i] === '\\') {
      i += 2;
      continue;
    }
    if (state.src[i] === '=' && state.src[i + 1] === '=') {
      // Char before the closing == must not be whitespace
      if (i > state.pos + 2 && !isWhitespace(state.src[i - 1])) {
        if (silent) return true;

        state.push('mark_open', '', 1);

        // Tokenize inner
        const savedPos = state.pos;
        const savedPosMax = state.posMax;
        state.pos = state.pos + 2;
        state.posMax = i;
        state.md.inline.tokenize(state);
        state.pos = savedPos;
        state.posMax = savedPosMax;

        state.push('mark_close', '', -1);

        state.pos = i + 2;
        return true;
      }
    }
    i++;
  }

  return false;
}

export function markPlugin(md: MarkdownItType): void {
  md.inline.ruler.after('escape', 'docuteach_mark', markRule);
}
