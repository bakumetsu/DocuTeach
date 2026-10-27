import type { MarkdownIt as MarkdownItType, StateBlock } from 'markdown-it';

function rawRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const bMarks = state.bMarks;
  const eMarks = state.eMarks;
  const src = state.src;

  const line = startLine;
  const rawStart = bMarks[line];
  const rawEnd = eMarks[line];
  const rawLine = src.slice(rawStart, rawEnd);

  // Check indent < 4 (leading spaces/tabs)
  let firstNonSpace = 0;
  while (
    firstNonSpace < rawLine.length &&
    (rawLine.charCodeAt(firstNonSpace) === 0x20 || rawLine.charCodeAt(firstNonSpace) === 0x09)
  ) {
    firstNonSpace++;
  }
  if (firstNonSpace >= 4) return false;

  const text = rawLine.slice(firstNonSpace);

  // --- 1. Fenced code ---
  const fenceMatch = text.match(/^(`{3,}|~{3,})(.*)$/);
  if (fenceMatch) {
    const fenceChar = fenceMatch[1][0];
    const fenceLen = fenceMatch[1].length;

    // Find closing fence: same char, at least fenceLen, nothing else but spaces
    let closeLine = -1;
    for (let i = line + 1; i < endLine; i++) {
      const iLine = src.slice(bMarks[i], eMarks[i]);
      const trimmed = iLine.trim();
      if (trimmed.length >= fenceLen) {
        let allFence = true;
        for (let j = 0; j < trimmed.length; j++) {
          if (trimmed[j] !== fenceChar) {
            allFence = false;
            break;
          }
        }
        if (allFence) {
          closeLine = i;
          break;
        }
      }
    }

    const lastLine = closeLine === -1 ? endLine - 1 : closeLine;

    if (!silent) {
      const lines: string[] = [];
      for (let i = line; i <= lastLine; i++) {
        lines.push(src.slice(bMarks[i], eMarks[i]));
      }
      const t = state.push('raw_block', '', 0);
      t.content = lines.join('\n');
      t.map = [line, lastLine + 1];
      state.line = lastLine + 1;
    }
    return true;
  }

  // --- 2. Blockquote ---
  if (text[0] === '>') {
    let lastLine = line;
    for (let i = line + 1; i < endLine; i++) {
      const iLine = src.slice(bMarks[i], eMarks[i]);
      // Check: after up to 3 leading spaces, the next char is '>'
      let j = 0;
      while (j < 3 && j < iLine.length && iLine[j] === ' ') {
        j++;
      }
      if (j < iLine.length && iLine[j] === '>') {
        lastLine = i;
      } else {
        break;
      }
    }

    if (!silent) {
      const lines: string[] = [];
      for (let i = line; i <= lastLine; i++) {
        lines.push(src.slice(bMarks[i], eMarks[i]));
      }
      const t = state.push('raw_block', '', 0);
      t.content = lines.join('\n');
      t.map = [line, lastLine + 1];
      state.line = lastLine + 1;
    }
    return true;
  }

  // --- 3. Horizontal rule ---
  const hrText = text.trim();
  if (
    hrText.length >= 3 &&
    /^(-(\s*-){2,}|\*(\s*\*){2,}|_(\s*_){2,})$/.test(hrText)
  ) {
    if (!silent) {
      const t = state.push('raw_block', '', 0);
      t.content = rawLine;
      t.map = [line, line + 1];
      state.line = line + 1;
    }
    return true;
  }

  // --- 4. HTML block ---
  if (text[0] === '<' && text.length > 1) {
    const nextChar = text[1];
    const isAsciiLetter =
      (nextChar >= 'a' && nextChar <= 'z') || (nextChar >= 'A' && nextChar <= 'Z');
    if (isAsciiLetter) {
      // Runs until next blank line (exclusive — blank line is NOT included)
      let lastLine = line;
      for (let i = line + 1; i < endLine; i++) {
        const iLine = src.slice(bMarks[i], eMarks[i]);
        if (iLine.trim() === '') break;
        lastLine = i;
      }

      if (!silent) {
        const lines: string[] = [];
        for (let i = line; i <= lastLine; i++) {
          lines.push(src.slice(bMarks[i], eMarks[i]));
        }
        const t = state.push('raw_block', '', 0);
        t.content = lines.join('\n');
        t.map = [line, lastLine + 1];
        state.line = lastLine + 1;
      }
      return true;
    }
  }

  return false;
}

export function rawPlugin(md: MarkdownItType): void {
  md.block.ruler.before('list', 'docuteach_raw', rawRule, { alt: ['paragraph'] });
}
