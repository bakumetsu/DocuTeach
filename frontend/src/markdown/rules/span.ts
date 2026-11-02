import type { MarkdownIt as MarkdownItType, StateInline, Token } from 'markdown-it';

const VALID_CLASSES = new Set(['u', 'b', 'i', 'hl']);

function spanRule(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== '[') return false;

  // Find matching ] (nesting-aware, skip backslash-escaped chars)
  let level = 1;
  let i = state.pos + 1;
  while (i < state.posMax) {
    if (state.src[i] === '\\' && i + 1 < state.posMax) {
      i += 2;
      continue;
    }
    if (state.src[i] === '[') level++;
    else if (state.src[i] === ']') {
      level--;
      if (level === 0) break;
    }
    i++;
  }

  if (i >= state.posMax || state.src[i] !== ']') return false;

  // Expect { immediately after ]
  let j = i + 1;
  if (j >= state.posMax || state.src[j] !== '{') return false;
  j++;

  // Parse tokens separated by single spaces (.class, font="...", size=N)
  const classes: string[] = [];
  let font: string | undefined;
  let size: number | undefined;
  let first = true;
  while (j < state.posMax && state.src[j] !== '}') {
    if (!first) {
      if (state.src[j] !== ' ') return false;
      j++;
    }
    first = false;
    if (j >= state.posMax) return false;

    if (state.src[j] === '.') {
      // .class token
      j++;
      let cls = '';
      while (j < state.posMax && state.src[j] !== ' ' && state.src[j] !== '}') {
        cls += state.src[j];
        j++;
      }
      if (cls === '') return false;
      classes.push(cls);
    } else if (state.src.slice(j, j + 6) === 'font="') {
      // font="Name" token
      j += 6;
      let val = '';
      while (j < state.posMax && state.src[j] !== '"') {
        val += state.src[j];
        j++;
      }
      if (j >= state.posMax) return false;
      j++; // skip closing "
      if (font !== undefined) return false;
      if (!/^[\p{L}\p{N} -]{1,40}$/u.test(val)) return false;
      font = val;
    } else if (state.src.slice(j, j + 5) === 'size=') {
      // size=N token
      j += 5;
      let num = '';
      while (j < state.posMax && state.src[j] !== ' ' && state.src[j] !== '}') {
        num += state.src[j];
        j++;
      }
      if (num === '') return false;
      if (!/^\d+(\.\d)?$/.test(num)) return false;
      const n = parseFloat(num);
      if (n < 6 || n > 72) return false;
      if (!Number.isInteger(n * 2)) return false;
      if (size !== undefined) return false;
      size = n;
    } else {
      return false;
    }
  }

  if (j >= state.posMax || state.src[j] !== '}') return false;

  // Validate all classes
  for (const c of classes) {
    if (!VALID_CLASSES.has(c)) return false;
  }
  if (classes.length === 0 && font === undefined && size === undefined) return false;

  if (silent) return true;

  const innerStart = state.pos + 1;
  const innerEnd = i; // position of ]

  // Push span_open
  const openToken: Token = state.push('span_open', '', 1);
  const meta: Record<string, unknown> = { classes };
  if (font !== undefined) meta.font = font;
  if (size !== undefined) meta.size = size;
  openToken.meta = meta;

  // Tokenize inner content
  const savedPos = state.pos;
  const savedPosMax = state.posMax;
  state.pos = innerStart;
  state.posMax = innerEnd;
  state.md.inline.tokenize(state);
  state.pos = savedPos;
  state.posMax = savedPosMax;

  // Push span_close
  state.push('span_close', '', -1);

  state.pos = j + 1; // after }
  return true;
}

export function spanPlugin(md: MarkdownItType): void {
  md.inline.ruler.after('escape', 'docuteach_span', spanRule);
}
