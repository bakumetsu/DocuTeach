/**
 * Pre-pass that rewrites model-written multiple-choice-question forms into
 * the document syntax the existing markdown-it parser understands.
 *
 * Target syntax:
 *   Question paragraph
 *   - [ ] wrong option
 *   - [x] correct option
 *
 * Everything that is not part of an MCQ option block / answer line passes
 * through byte-for-byte unchanged.  No markdown-it, no AST – plain text ops.
 */

export function normalizeModelMarkdown(md: string): string {
  const lines = md.split('\n');
  const result: string[] = [];
  let i = 0;
  let inCodeBlock = false;

  while (i < lines.length) {
    const line = lines[i];

    // Toggle fenced code block
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      i++;
      continue;
    }

    // Pass through code-block content untouched
    if (inCodeBlock) {
      result.push(line);
      i++;
      continue;
    }

    // Try to collect a consecutive option block starting at i
    const { opts, end: blockEnd } = collectOptionBlock(lines, i);

    if (opts.length >= 2) {
      // Scan forward for an answer line (blank lines between are allowed)
      let answerIdx = -1;
      let answerLetters: string[] | null = null;

      let j = blockEnd;
      while (j < lines.length && !/^```/.test(lines[j])) {
        if (lines[j].trim() === '') {
          j++;
          continue;
        }
        const letters = parseAnswerLine(lines[j]);
        if (letters) {
          answerIdx = j;
          answerLetters = letters;
        }
        break; // stop at first non-blank line
      }

      const hasExistingX = opts.some(o => o.alreadyCorrect);
      let converted = false;

      if (answerLetters !== null) {
        const allTargetForm = opts.every(o => o.letter === null);

        if (allTargetForm) {
          // Already in target form with an answer line → drop answer line,
          // keep existing [x] marks.
          removeTrailingBlank(result);
          for (const opt of opts) {
            result.push(`- [${opt.alreadyCorrect ? 'x' : ' '}] ${opt.text}`);
          }
          i = answerIdx + 1; // skip past the answer line
          converted = true;
        } else {
          // Every answer letter must map to a letter-bearing option in the block
          const validLetters = new Set(
            opts.filter(o => o.letter !== null).map(o => o.letter!),
          );
          const allValid = answerLetters.every(l => validLetters.has(l));

          if (allValid) {
            removeTrailingBlank(result);
            for (const opt of opts) {
              const correct =
                opt.letter !== null
                  ? answerLetters.includes(opt.letter)
                  : opt.alreadyCorrect;
              result.push(`- [${correct ? 'x' : ' '}] ${opt.text}`);
            }
            i = answerIdx + 1; // skip past the answer line
            converted = true;
          }
        }
      } else if (hasExistingX) {
        // No answer line but at least one [x] already present → normalise
        removeTrailingBlank(result);
        for (const opt of opts) {
          const correct = opt.letter !== null ? false : opt.alreadyCorrect;
          result.push(`- [${correct ? 'x' : ' '}] ${opt.text}`);
        }
        i = blockEnd;
        converted = true;
      }

      if (converted) i = absorbExplanation(lines, i, result);

      if (!converted) {
        // Leave block (and answer line, if one was found) untouched
        const passEnd = answerIdx >= 0 ? answerIdx + 1 : blockEnd;
        for (let k = i; k < passEnd; k++) {
          result.push(lines[k]);
        }
        i = passEnd;
      }
      continue;
    }

    // Ordinary line – pass through
    result.push(line);
    i++;
  }

  return result.join('\n');
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface OptInfo {
  /** Letter A–H if the line used a letter form; null for already-formatted. */
  letter: string | null;
  /** The option text (everything after the marker). */
  text: string;
  /** True when the line is already `- [x] …`. */
  alreadyCorrect: boolean;
}

/**
 * Collect consecutive option lines starting at `start`.
 * Returns `{ opts, end }` where `end` is the index just past the last line
 * consumed (may include a single tolerated blank line between options).
 * Returns an empty array for `opts` if the line at `start` is not an option.
 */
function collectOptionBlock(
  lines: string[],
  start: number,
): { opts: OptInfo[]; end: number } {
  const opts: OptInfo[] = [];
  let i = start;
  while (i < lines.length && !/^```/.test(lines[i])) {
    const opt = matchOptionLine(lines[i]);
    if (opt === null) {
      // Allow exactly one blank line if the next line is another option.
      if (
        lines[i].trim() === '' &&
        i + 1 < lines.length &&
        !/^```/.test(lines[i + 1]) &&
        matchOptionLine(lines[i + 1]) !== null
      ) {
        i++;
        continue;
      }
      break;
    }
    opts.push(opt);
    i++;
  }
  return { opts, end: i };
}

/**
 * Match a single line against all recognised option-line forms.
 * Returns null when the line is not an option line.
 */
function matchOptionLine(line: string): OptInfo | null {
  // Already in target form:  "- [ ] text"  /  "- [x] text"
  let m = line.match(/^-\s*\[([ x])\]\s+(.*)$/);
  if (m) {
    return { letter: null, text: m[2], alreadyCorrect: m[1] === 'x' };
  }

  // Letter-based:  optional "- " or "* " prefix, letter A–H, ")" or ".", text
  //   A) text / A. text / - A) text / - A. text / * A) text …
  m = line.match(/^(?:[-*]\s)?([A-H])\s*[.)]\s+(.*)$/i);
  if (m) {
    return { letter: m[1].toUpperCase(), text: m[2], alreadyCorrect: false };
  }

  return null;
}

/**
 * Parse an answer line and return the list of option letters it marks correct,
 * or null if the line is not an answer line.
 *
 * Recognised forms (case-insensitive):
 *   Answer: B            Correct answer: B
 *   **Answer: B**        > Answer: B          > **Answer: B**
 *   Answer: B) text      Answer: B, D         Answer: B and D
 */
function parseAnswerLine(line: string): string[] | null {
  let s = line.trim();
  // Strip optional "> " blockquote prefix
  s = s.replace(/^>\s*/, '');
  // Strip surrounding bold
  s = s.replace(/^\*\*(.*)\*\*$/, '$1');

  const m = s.match(/^(?:correct\s+)?answer\s*:\s*(.+)$/i);
  if (!m) return null;

  let content = m[1].trim();

  // "B) some text" → keep only "B"
  const parenIdx = content.indexOf(')');
  if (parenIdx >= 0) {
    content = content.slice(0, parenIdx).trim();
  }

  // Split on ", " or " and "
  const parts = content.split(/\s+and\s+|,\s*/i);
  const letters: string[] = [];
  for (const part of parts) {
    const p = part.trim();
    if (/^[A-H]$/i.test(p)) {
      letters.push(p.toUpperCase());
    }
  }

  return letters.length > 0 ? letters : null;
}

/**
 * Text after a converted MCQ (the model's explanation or distractor reasoning)
 * becomes a teacher note on that question, so it never reaches the student.
 * Stops at a heading, list, table, fence or a following question (a paragraph
 * followed by options).  Returns the index to continue from.
 */
function absorbExplanation(
  lines: string[],
  start: number,
  result: string[],
): number {
  const note: string[] = [];
  let i = start;
  for (;;) {
    let j = i;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length) break;
    if (/^(#|```|:::|\||>|\s*([-*+]|\d+[.)])\s)/.test(lines[j])) break;
    let k = j;
    while (k < lines.length && lines[k].trim() !== '') k++;
    // A block directly followed by options is the next question.
    let n = k;
    while (n < lines.length && lines[n].trim() === '') n++;
    if (n < lines.length && matchOptionLine(lines[n]) !== null) break;
    if (matchOptionLine(lines[j]) !== null) break;
    if (note.length > 0) note.push('');
    note.push(...lines.slice(j, k));
    i = k;
  }
  if (note.length === 0) return start;
  result.push('', '::: teacher', ...note, ':::');
  return i;
}

/** Remove a single trailing blank line from the result (question→options gap). */
function removeTrailingBlank(result: string[]): void {
  if (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
}
