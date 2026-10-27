import type { MarkdownIt as MarkdownItType, StateBlock } from 'markdown-it';

/**
 * Split a table row into cells.
 * - Trims the line.
 * - Drops one leading `|` and one trailing unescaped `|`.
 * - Splits on `|` except:
 *   (a) `|` inside a blank `{{ ... }}` never splits.
 *   (b) `|` preceded by an odd number of backslashes outside blanks is escaped
 *       (becomes a literal `|`, one backslash removed).
 * - Each cell is trimmed.
 */
export function splitRow(line: string): string[] {
  let s = line.trim();

  // Drop one leading |
  if (s.startsWith('|')) {
    s = s.slice(1);
  }

  // Drop one trailing unescaped |
  if (s.endsWith('|')) {
    let i = s.length - 2;
    let bs = 0;
    while (i >= 0 && s[i] === '\\') {
      bs++;
      i--;
    }
    if (bs % 2 === 0) {
      s = s.slice(0, -1);
    }
  }

  const cells: string[] = [];
  let current = '';
  let inBlank = false;
  let i = 0;

  while (i < s.length) {
    if (inBlank) {
      // Check for closing }}
      if (s[i] === '}' && i + 1 < s.length && s[i + 1] === '}') {
        let j = i - 1;
        let bs = 0;
        while (j >= 0 && s[j] === '\\') {
          bs++;
          j--;
        }
        if (bs % 2 === 0) {
          // Closes the blank
          current += '}}';
          i += 2;
          inBlank = false;
          continue;
        }
      }
      // Inside blank: pass through unchanged
      current += s[i];
      i++;
    } else {
      // Check for opening {{
      if (s[i] === '{' && i + 1 < s.length && s[i + 1] === '{') {
        inBlank = true;
        current += s[i];
        i++;
        continue;
      }

      // Check for |
      if (s[i] === '|') {
        let j = i - 1;
        let bs = 0;
        while (j >= 0 && s[j] === '\\') {
          bs++;
          j--;
        }
        if (bs % 2 === 1) {
          // Escaped pipe: remove one backslash, add literal |
          current = current.slice(0, -1) + '|';
        } else {
          // Real separator
          cells.push(current.trim());
          current = '';
        }
        i++;
        continue;
      }

      current += s[i];
      i++;
    }
  }

  cells.push(current.trim());
  return cells;
}

/**
 * Returns true if the line contains at least one unescaped `|` outside blanks.
 */
function hasUnescapedPipe(line: string): boolean {
  let inBlank = false;
  for (let i = 0; i < line.length; i++) {
    if (inBlank) {
      if (line[i] === '}' && i + 1 < line.length && line[i + 1] === '}') {
        let j = i - 1;
        let bs = 0;
        while (j >= 0 && line[j] === '\\') {
          bs++;
          j--;
        }
        if (bs % 2 === 0) {
          inBlank = false;
          i++;
        }
      }
    } else {
      if (line[i] === '{' && i + 1 < line.length && line[i + 1] === '{') {
        inBlank = true;
        i++;
      } else if (line[i] === '|') {
        let j = i - 1;
        let bs = 0;
        while (j >= 0 && line[j] === '\\') {
          bs++;
          j--;
        }
        if (bs % 2 === 0) return true;
      }
    }
  }
  return false;
}

function tableRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  // --- Header line ---
  const headerFull = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]);
  const indent = headerFull.length - headerFull.trimStart().length;
  if (indent >= 4) return false;

  const headerText = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
  if (!hasUnescapedPipe(headerText)) return false;

  // --- Alignment row (next line) ---
  if (startLine + 1 >= endLine) return false;

  const alignText = state.src.slice(state.bMarks[startLine + 1] + state.tShift[startLine + 1], state.eMarks[startLine + 1]);
  const alignCells = splitRow(alignText);
  const headerCells = splitRow(headerText);

  if (alignCells.length !== headerCells.length) return false;
  for (const cell of alignCells) {
    if (!/^:?-+:?$/.test(cell)) return false;
  }

  if (silent) return true;

  // --- Body rows ---
  const bodyStart = startLine + 2;
  let bodyEnd = bodyStart;

  while (bodyEnd < endLine) {
    if (state.isEmpty(bodyEnd)) break;
    const bodyText = state.src.slice(state.bMarks[bodyEnd] + state.tShift[bodyEnd], state.eMarks[bodyEnd]);
    if (!hasUnescapedPipe(bodyText)) break;
    bodyEnd++;
  }

  // Collect all rows and find widest
  const bodyRows: string[][] = [];
  for (let line = bodyStart; line < bodyEnd; line++) {
    const rowText = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    bodyRows.push(splitRow(rowText));
  }

  let maxCols = headerCells.length;
  for (const row of bodyRows) {
    if (row.length > maxCols) maxCols = row.length;
  }

  // Pad all rows to maxCols
  while (headerCells.length < maxCols) headerCells.push('');
  for (const row of bodyRows) {
    while (row.length < maxCols) row.push('');
  }

  // --- Emit tokens ---
  const tableOpen = state.push('table_open', 'table', 1);
  tableOpen.map = [startLine, bodyEnd];

  state.push('thead_open', 'thead', 1);
  state.push('tr_open', 'tr', 1);
  for (const cell of headerCells) {
    state.push('th_open', 'th', 1);
    const inline = state.push('inline', '', 0);
    inline.content = cell;
    inline.children = [];
    inline.map = [startLine, startLine + 1];
    state.push('th_close', 'th', -1);
  }
  state.push('tr_close', 'tr', -1);
  state.push('thead_close', 'thead', -1);

  if (bodyRows.length > 0) {
    state.push('tbody_open', 'tbody', 1);
    for (let r = 0; r < bodyRows.length; r++) {
      const line = bodyStart + r;
      state.push('tr_open', 'tr', 1);
      for (const cell of bodyRows[r]) {
        state.push('td_open', 'td', 1);
        const inline = state.push('inline', '', 0);
        inline.content = cell;
        inline.children = [];
        inline.map = [line, line + 1];
        state.push('td_close', 'td', -1);
      }
      state.push('tr_close', 'tr', -1);
    }
    state.push('tbody_close', 'tbody', -1);
  }

  state.push('table_close', 'table', -1);

  state.line = bodyEnd;
  return true;
}

export function tablePlugin(md: MarkdownItType): void {
  md.block.ruler.before('list', 'docuteach_table', tableRule);
}
