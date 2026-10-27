import type { MarkdownIt as MarkdownItType, StateBlock } from 'markdown-it';
import { unescapeTag } from '../escape';

const ALIGN_RE = /^::: \{\.(center|right|justify)\}\s*$/;
const BARE_RE = /^:::\s*$/;
const TEACHER_RE = /^::: teacher(?:\s+\{tag="((?:[^"\\]|\\.)*)"\})?\s*$/;

type Align = 'center' | 'right' | 'justify';

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function rawLineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line], state.eMarks[line]);
}

function isBareClose(text: string): boolean {
  return BARE_RE.test(text);
}

function alignFrom(text: string): Align | null {
  const m = ALIGN_RE.exec(text);
  if (!m) return null;
  return m[1] as Align;
}

function teacherTagFrom(text: string): string | null {
  const m = TEACHER_RE.exec(text);
  if (!m) return null;
  return m[1] === undefined ? '' : unescapeTag(m[1]);
}

function findCloseLine(state: StateBlock, startLine: number, endLine: number): number | null {
  let depth = 1;
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(state, line);
    if (isBareClose(text)) {
      depth -= 1;
      if (depth === 0) return line;
    } else if (alignFrom(text) !== null) {
      depth += 1;
    }
  }
  return null;
}

function rawBlockContent(state: StateBlock, startLine: number, endLine: number): string {
  const lines: string[] = [];
  for (let line = startLine; line < endLine; line++) {
    lines.push(rawLineText(state, line));
  }
  return lines.join('\n');
}

function addWarning(state: StateBlock, message: string): void {
  const warnings = (state.env.warnings ??= []);
  if (Array.isArray(warnings)) {
    warnings.push(message);
  } else {
    state.env.warnings = [message];
  }
}

function tokenizeNestedBlocks(
  state: StateBlock,
  startLine: number,
  endLine: number,
  parentType: string,
): void {
  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;

  state.parentType = parentType as never;
  state.lineMax = endLine;
  state.line = startLine;
  state.md.block.tokenize(state, startLine, endLine);
  state.line = endLine;

  state.lineMax = oldLineMax;
  state.parentType = oldParent;
}

export function divPlugin(md: MarkdownItType): void {
  md.block.ruler.before('list', 'div', (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
    if (state.tShift[startLine] >= 4) return false;

    const text = lineText(state, startLine);
    if (!text.startsWith(':::')) return false;

    const parentType = (state.parentType as string | null | undefined) ?? null;

    // Top level: markdown-it sets parentType to 'root' at the document root.
    const isTopLevel = parentType === null || parentType === undefined || parentType === 'root';
    // Blockquote / list are transparent containers — they don't restrict openers.
    const isContainer = parentType === 'blockquote' || parentType === 'list';
    // Teacher and unknown (raw) blocks are allowed at top level and inside containers.
    const allowedForTeacherAndUnknown = isTopLevel || isContainer;
    // Align is additionally allowed inside 'teacher' and nested 'align'.
    const allowedForAlign = allowedForTeacherAndUnknown || parentType === 'teacher' || parentType === 'align';

    if (isBareClose(text)) {
      return false;
    }

    const align = alignFrom(text);
    if (align !== null) {
      if (silent) return true;
      if (!allowedForAlign) return false;

      const closeLine = findCloseLine(state, startLine, endLine);
      const blockEnd = closeLine === null ? endLine : closeLine + 1;

      if (closeLine === null) {
        addWarning(state, 'Unclosed alignment block');
      }

      const open = state.push('align_open', 'div', 1);
      open.map = [startLine, blockEnd];
      open.meta = { align };

      tokenizeNestedBlocks(state, startLine + 1, closeLine === null ? endLine : closeLine, 'align');

      const close = state.push('align_close', 'div', -1);
      close.map = closeLine === null ? [endLine, endLine] : [closeLine, closeLine + 1];

      state.line = closeLine === null ? endLine : closeLine + 1;
      return true;
    }

    if (!allowedForTeacherAndUnknown) {
      return false;
    }

    const tag = teacherTagFrom(text);
    if (tag !== null) {
      if (silent) return true;

      const closeLine = findCloseLine(state, startLine, endLine);
      const blockEnd = closeLine === null ? endLine : closeLine + 1;

      if (closeLine === null) {
        addWarning(state, 'Unclosed teacher note runs to the end of the file');
      }

      const open = state.push('teacher_open', 'div', 1);
      open.map = [startLine, blockEnd];
      open.meta = { tag };

      tokenizeNestedBlocks(state, startLine + 1, closeLine === null ? endLine : closeLine, 'teacher');

      const close = state.push('teacher_close', 'div', -1);
      close.map = closeLine === null ? [endLine, endLine] : [closeLine, closeLine + 1];

      state.line = closeLine === null ? endLine : closeLine + 1;
      return true;
    }

    if (silent) return true;

    const closeLine = findCloseLine(state, startLine, endLine);
    const blockEnd = closeLine === null ? endLine : closeLine + 1;

    if (closeLine === null) {
      addWarning(state, 'Unclosed block');
    }

    const raw = state.push('raw_block', 'div', 0);
    raw.map = [startLine, blockEnd];
    raw.content = rawBlockContent(state, startLine, blockEnd);

    state.line = blockEnd;
    return true;
  }, { alt: ['paragraph'] });
}
