import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../src/markdown/parse';
import { projectStudent } from '../src/editor/project';
import { generateHTML } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { buildEditorExtensions } from '../src/editor/extensions-ui';
import { Editor } from '@tiptap/core';

// ── Build a document containing every teacher-only item with unique markers ──

const MD = `---
custom_key: MARK_FRONT_MATTER
---

Intro paragraph.

::: teacher {tag="MARK_NOTE_TAG"}
MARK_NOTE_TEXT
:::

1. A sentence with {{MARK_ANSWER_MAIN | MARK_ANSWER_ALT}} inline.

| Header | Cell |
| --- | --- |
| Text | {{MARK_ANSWER_CELL}} |

Pick one:
- [ ] MARK_OPT_WRONG
- [x] MARK_OPT_RIGHT

::: teacher {tag="Distractors"}
MARK_DISTRACTOR_TEXT
:::

Pick all:
- [x] MARK_OPT_A
- [x] MARK_OPT_B
- [ ] MARK_OPT_C

\`\`\`
MARK_RAW_TEXT
\`\`\`

- List item one
- List item two
`;

function buildDoc() {
  return parseMarkdown(MD).doc;
}

type JsonNode = { type?: string; content?: JsonNode[]; attrs?: Record<string, unknown> };

describe('projectStudent', () => {
  const forbidden = [
    'MARK_NOTE_TEXT',
    'MARK_NOTE_TAG',
    'MARK_ANSWER_MAIN',
    'MARK_ANSWER_ALT',
    'MARK_ANSWER_CELL',
    'MARK_DISTRACTOR_TEXT',
    'MARK_RAW_TEXT',
    'MARK_FRONT_MATTER',
    '"correct":true',
    'teacherNote',
    'rawBlock',
  ];

  it('removes all teacher-only data from JSON', () => {
    const doc = buildDoc();
    const s = projectStudent(doc);
    const json = JSON.stringify(s.toJSON());

    for (const marker of forbidden) {
      expect(json, `should not contain ${marker}`).not.toContain(marker);
    }

    // Student-visible content is preserved
    expect(json).toContain('MARK_OPT_WRONG');
    expect(json).toContain('MARK_OPT_RIGHT');
  });

  it('removes all teacher-only data from generated HTML', () => {
    const doc = buildDoc();
    const s = projectStudent(doc);
    const html = generateHTML(s.toJSON(), extensions);

    for (const marker of forbidden) {
      expect(html, `HTML should not contain ${marker}`).not.toContain(marker);
    }

    expect(html).toContain('MARK_OPT_WRONG');
    expect(html).toContain('MARK_OPT_RIGHT');
  });

  it('derives multi correctly and clears correct everywhere', () => {
    const doc = buildDoc();
    const s = projectStudent(doc);
    const json = s.toJSON();

    // Collect all mcq nodes
    const mcqs: JsonNode[] = [];
    const mcqOptions: JsonNode[] = [];

    function walk(n: JsonNode) {
      if (n.type === 'mcq') mcqs.push(n);
      if (n.type === 'mcqOption') mcqOptions.push(n);
      if (n.content) n.content.forEach((c) => walk(c));
    }
    walk(json as JsonNode);

    expect(mcqs.length).toBeGreaterThanOrEqual(2);

    // First MCQ: 1 correct → multi false
    expect(mcqs[0].attrs!.multi).toBe(false);
    // Second MCQ: 2 correct → multi true
    expect(mcqs[1].attrs!.multi).toBe(true);

    // All options have correct: false
    for (const opt of mcqOptions) {
      expect(opt.attrs!.correct).toBe(false);
    }
  });

  it('does not mutate the original document', () => {
    const doc = buildDoc();
    const originalJson = JSON.stringify(doc.toJSON());
    expect(originalJson).toContain('MARK_NOTE_TEXT');

    projectStudent(doc);

    // Original is untouched
    const afterJson = JSON.stringify(doc.toJSON());
    expect(afterJson).toBe(originalJson);
    expect(afterJson).toContain('MARK_NOTE_TEXT');
  });

  it('is idempotent (projecting twice gives equal JSON)', () => {
    const doc = buildDoc();
    const s1 = projectStudent(doc);
    const s2 = projectStudent(s1);
    expect(JSON.stringify(s2.toJSON())).toBe(JSON.stringify(s1.toJSON()));
  });

  it('clipboard serialization contains no teacher data', () => {
    const doc = buildDoc();
    const s = projectStudent(doc);

    const editor = new Editor({
      element: document.createElement('div'),
      editable: false,
      extensions: buildEditorExtensions(),
      content: s.toJSON(),
    });

    editor.commands.selectAll();
    const { dom, text } = editor.view.serializeForClipboard(editor.state.selection.content());

    const innerHTML: string = dom.innerHTML;
    const textStr: string = text;

    for (const marker of forbidden) {
      expect(innerHTML, `clipboard DOM should not contain ${marker}`).not.toContain(marker);
      expect(textStr, `clipboard text should not contain ${marker}`).not.toContain(marker);
    }

    editor.destroy();
  });
});
