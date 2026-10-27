import { Node as PMNode } from '@tiptap/pm/model';
import type { MarkdownIt as MarkdownItType } from 'markdown-it';
import { createMd } from './md';
import { splitFrontMatter, EMPTY_META } from './frontmatter';
import type { Meta } from './frontmatter';
import { buildBlocks } from './blocks';
import type { BuildCtx } from './blocks';
import { schema } from '../editor/extensions';

const md: MarkdownItType = createMd();

export interface ParseResult {
  meta: Meta;
  doc: PMNode;
  warnings: string[];
}

export function parseMarkdown(text: string): ParseResult {
  try {
    // Strip BOM
    let src = text;
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

    // Normalize line endings
    src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split front matter
    const { meta, body, warning } = splitFrontMatter(src);
    const warnings: string[] = [];
    if (warning) warnings.push(warning);

    // Parse body
    const env: { warnings?: string[] } = { warnings: [] };
    const tokens = md.parse(body, env);
    const lines = body.split('\n');
    const ctx: BuildCtx = { warnings: [], splitSeen: false };

    const nodes = buildBlocks(tokens, lines, schema, ctx);

    // Collect warnings
    if (env.warnings) warnings.push(...env.warnings);
    warnings.push(...ctx.warnings);

    // Count rawBlock nodes that are NOT split leftovers
    // A split leftover is a rawBlock whose text matches a split_point source
    // We can't easily distinguish, so count all rawBlocks
    let rawCount = 0;
    for (const n of nodes) {
      if (n.type.name === 'rawBlock') rawCount++;
    }
    if (rawCount > 0) {
      warnings.push(`${rawCount} unsupported block(s) kept as written`);
    }

    // Build doc
    const finalNodes = nodes.length ? nodes : [schema.nodes.paragraph.create({})];
    const doc = schema.nodes.doc.create({ meta }, finalNodes);

    return { meta, doc, warnings };
  } catch (e) {
    const warnings = ['Parse error: ' + (e instanceof Error ? e.message : String(e))];
    const para = schema.nodes.paragraph.create({}, [schema.text(text)]);
    const doc = schema.nodes.doc.create({ meta: EMPTY_META }, [para]);
    return { meta: EMPTY_META, doc, warnings };
  }
}

export function parseFragment(mdText: string): { nodes: PMNode[]; warnings: string[] } {
  try {
    let src = mdText;
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
    src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const env: { warnings?: string[] } = { warnings: [] };
    const tokens = md.parse(src, env);
    const lines = src.split('\n');
    const ctx: BuildCtx = { warnings: [], splitSeen: false };

    const nodes = buildBlocks(tokens, lines, schema, ctx);

    const warnings: string[] = [];
    if (env.warnings) warnings.push(...env.warnings);
    warnings.push(...ctx.warnings);

    return { nodes, warnings };
  } catch (e) {
    const warnings = ['Parse error: ' + (e instanceof Error ? e.message : String(e))];
    const para = schema.nodes.paragraph.create({}, [schema.text(mdText)]);
    return { nodes: [para], warnings };
  }
}
