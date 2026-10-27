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

  // Parse one or more .class tokens separated by single spaces
  const classes: string[] = [];
  let first = true;
  while (j < state.posMax && state.src[j] !== '}') {
    if (!first) {
      if (state.src[j] !== ' ') return false;
      j++;
    }
    first = false;
    if (j >= state.posMax || state.src[j] !== '.') return false;
    j++;
    let cls = '';
    while (j < state.posMax && state.src[j] !== ' ' && state.src[j] !== '}') {
      cls += state.src[j];
      j++;
    }
    if (cls === '') return false;
    classes.push(cls);
  }

  if (j >= state.posMax || state.src[j] !== '}') return false;

  // Validate all classes
  for (const c of classes) {
    if (!VALID_CLASSES.has(c)) return false;
  }
  if (classes.length === 0) return false;

  if (silent) return true;

  const innerStart = state.pos + 1;
  const innerEnd = i; // position of ]

  // Push span_open
  const openToken: Token = state.push('span_open', '', 1);
  openToken.meta = { classes };

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
