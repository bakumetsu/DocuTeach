import type { MarkdownIt as MarkdownItType, StateBlock } from 'markdown-it';

export function commentPlugin(md: MarkdownItType): void {
  function rule(
    state: StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean,
  ): boolean {
    if (state.sCount[startLine] >= 4) return false;

    const line = state.src.slice(
      state.bMarks[startLine] + state.tShift[startLine],
      state.eMarks[startLine],
    );

    if (!line.startsWith('<!--')) return false;

    // Find the line containing -->
    let closeLine = -1;
    for (let i = startLine; i < endLine; i++) {
      const l = state.src.slice(
        state.bMarks[i] + state.tShift[i],
        state.eMarks[i],
      );
      if (l.includes('-->')) {
        closeLine = i;
        break;
      }
    }

    if (closeLine === -1) {
      closeLine = endLine - 1;
    }

    if (silent) return true;

    // Single-line split_point check
    if (closeLine === startLine) {
      const trimmed = line.trim();
      const m = trimmed.match(/^<!--\s*split:\s*(.*?)\s*-->/);
      if (m) {
        const t = state.push('split_point', '', 0);
        t.map = [startLine, closeLine + 1];
        const label = m[1] === '' ? 'Homework starts here' : m[1];
        t.meta = { label };
        state.line = closeLine + 1;
        return true;
      }
    }

    // raw_block
    const parts: string[] = [];
    for (let i = startLine; i <= closeLine; i++) {
      parts.push(
        state.src.slice(
          state.bMarks[i] + state.tShift[i],
          state.eMarks[i],
        ),
      );
    }

    const t = state.push('raw_block', '', 0);
    t.map = [startLine, closeLine + 1];
    t.content = parts.join('\n');
    state.line = closeLine + 1;
    return true;
  }

  md.block.ruler.before('list', 'comment', rule, { alt: ['paragraph'] });
}
