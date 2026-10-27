import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseFragment } from '../src/markdown/parse';
import type { Node as PMNode } from '@tiptap/pm/model';

type J = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: J[];
  text?: string;
  marks?: { type: string }[];
};

function docJSON(text: string) {
  return parseMarkdown(text).doc.toJSON();
}

describe('parseMarkdown', () => {
  it('heading levels', () => {
    const json = docJSON('# H1\n\n## H2\n\n### H3');
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(3);
    expect(doc.content[0].type).toBe('heading');
    expect(doc.content[0].attrs?.level).toBe(1);
    expect(doc.content[1].type).toBe('heading');
    expect(doc.content[1].attrs?.level).toBe(2);
    expect(doc.content[2].type).toBe('heading');
    expect(doc.content[2].attrs?.level).toBe(3);
  });

  it('paragraph with marks (bold, italic, underline)', () => {
    const json = docJSON('Hello **world** and *it* and [under]{.u}');
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('paragraph');
    const paraContent = doc.content[0].content as J[];
    // Should have text nodes with marks
    const texts = paraContent.filter((n: J) => n.type === 'text');
    const allText = texts.map((n: J) => n.text).join('');
    expect(allText).toContain('Hello');
    expect(allText).toContain('world');
    expect(allText).toContain('it');
    expect(allText).toContain('under');
    // Check marks exist (schema uses 'bold', 'italic', 'underline', 'highlight')
    const boldNode = texts.find((n: J) => n.marks?.some((m: { type: string }) => m.type === 'bold'));
    expect(boldNode).toBeDefined();
  });

  it('bullet and ordered lists nested', () => {
    const md = '- a\n- b\n  - nested\n1. one\n2. two';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].type).toBe('bulletList');
    expect(doc.content[1].type).toBe('orderedList');
    // First bullet list has 2 items
    const bulletItems = doc.content[0].content as J[];
    expect(bulletItems).toHaveLength(2);
    expect(bulletItems[0].type).toBe('listItem');
    // Second item has nested list
    const secondItemContent = bulletItems[1].content as J[];
    expect(secondItemContent[0].type).toBe('paragraph');
    expect(secondItemContent[1].type).toBe('bulletList');
  });

  it('table 2x2', () => {
    const md = '| a | b |\n| --- | --- |\n| c | d |';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('table');
    const rows = doc.content[0].content as J[];
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe('tableRow');
    // Header row
    const headerCells = rows[0].content as J[];
    expect(headerCells).toHaveLength(2);
    expect(headerCells[0].type).toBe('tableHeader');
    // Body row
    expect(rows[1].type).toBe('tableRow');
    const bodyCells = rows[1].content as J[];
    expect(bodyCells).toHaveLength(2);
    expect(bodyCells[0].type).toBe('tableCell');
  });

  it('teacher note with tag', () => {
    const md = '::: teacher {tag="CCQ"}\nHello note\n:::';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('teacherNote');
    expect(doc.content[0].attrs?.tag).toBe('CCQ');
    const noteContent = doc.content[0].content as J[];
    expect(noteContent).toHaveLength(1);
    expect(noteContent[0].type).toBe('paragraph');
  });

  it('note with list', () => {
    const md = '::: teacher {tag="T"}\n- item one\n- item two\n:::';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('teacherNote');
    const noteContent = doc.content[0].content as J[];
    expect(noteContent).toHaveLength(1);
    expect(noteContent[0].type).toBe('bulletList');
  });

  it('align center on a paragraph', () => {
    const md = '::: {.center}\nCentered text\n:::';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('paragraph');
    expect(doc.content[0].attrs?.align).toBe('center');
  });

  it('blank in a paragraph', () => {
    const md = 'Answer: {{a|b|c}} done';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('paragraph');
    const paraContent = doc.content[0].content as J[];
    const blank = paraContent.find((n: J) => n.type === 'blank');
    expect(blank).toBeDefined();
  });

  it('MCQ with question (paragraph consumed)', () => {
    const md = 'Pick one:\n- [ ] A\n- [x] B\n- [ ] C';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('mcq');
    expect(doc.content[0].attrs?.multi).toBe(false);
    const mcqContent = doc.content[0].content as J[];
    expect(mcqContent).toHaveLength(4); // question + 3 options
    expect(mcqContent[0].type).toBe('mcqQuestion');
    expect(mcqContent[1].type).toBe('mcqOption');
    expect(mcqContent[1].attrs?.correct).toBe(false);
    expect(mcqContent[2].type).toBe('mcqOption');
    expect(mcqContent[2].attrs?.correct).toBe(true);
    expect(mcqContent[3].type).toBe('mcqOption');
    expect(mcqContent[3].attrs?.correct).toBe(false);
  });

  it('MCQ with blank line before list = paragraph + mcq with empty question', () => {
    const md = 'Pick one:\n\n- [ ] A\n- [x] B';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].type).toBe('paragraph');
    expect(doc.content[1].type).toBe('mcq');
    const mcqContent = doc.content[1].content as J[];
    expect(mcqContent[0].type).toBe('mcqQuestion');
    // Question should be empty (no text content)
    const qContent = mcqContent[0].content;
    expect(qContent == null || (Array.isArray(qContent) && qContent.length === 0)).toBe(true);
  });

  it('one-item checkbox list stays bulletList', () => {
    const md = '- [ ] Only one';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('bulletList');
  });

  it('two split points (second is rawBlock + warning)', () => {
    const md = 'Before\n\n<!-- split: Part 1 -->\n\nMiddle\n\n<!-- split: Part 2 -->\n\nAfter';
    const result = parseMarkdown(md);
    const doc = result.doc.toJSON() as { content: J[] };
    // Find splitPoint and rawBlock
    const splitPoints = doc.content.filter((n: J) => n.type === 'splitPoint');
    expect(splitPoints).toHaveLength(1);
    expect(splitPoints[0].attrs?.label).toBe('Part 1');
    // Second split point becomes rawBlock
    const rawBlocks = doc.content.filter((n: J) => n.type === 'rawBlock');
    expect(rawBlocks.length).toBeGreaterThanOrEqual(1);
    // Warning present
    expect(result.warnings.some(w => w.includes('Only one split point'))).toBe(true);
  });

  it('unclosed note warning', () => {
    const md = '::: teacher {tag="X"}\nUnclosed note\nno closing';
    const result = parseMarkdown(md);
    expect(result.warnings.some(w => w.toLowerCase().includes('unclosed') || w.toLowerCase().includes('teacher'))).toBe(true);
  });

  it('front matter meta.data', () => {
    const md = '---\ntitle: My Doc\nauthor: Bob\n---\n\nBody text';
    const result = parseMarkdown(md);
    expect(result.meta.data).toBeDefined();
    expect(result.meta.data?.title).toBe('My Doc');
    expect(result.meta.data?.author).toBe('Bob');
  });

  it('empty string gives doc with one empty paragraph', () => {
    const json = docJSON('');
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('paragraph');
    const pContent = doc.content[0].content;
    expect(pContent == null || (Array.isArray(pContent) && pContent.length === 0)).toBe(true);
  });

  it('fenced code -> rawBlock with exact text', () => {
    const md = '```js\nconst x = 1;\nconsole.log(x);\n```';
    const json = docJSON(md);
    const doc = json as { content: J[] };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('rawBlock');
    expect(doc.content[0].attrs?.text).toBe('```js\nconst x = 1;\nconsole.log(x);\n```');
  });

  it('parseFragment of a teacher note returns one teacherNote', () => {
    const { nodes }: { nodes: PMNode[] } = parseFragment('::: teacher {tag="CCQ"}\nFragment note\n:::');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type.name).toBe('teacherNote');
    expect((nodes[0].attrs as Record<string, unknown>).tag).toBe('CCQ');
  });
});
