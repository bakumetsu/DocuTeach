import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItType } from 'markdown-it';
import { blankPlugin } from './rules/blank';
import { spanPlugin } from './rules/span';
import { markPlugin } from './rules/mark';
import { divPlugin } from './rules/div';
import { commentPlugin } from './rules/comment';
import { rawPlugin } from './rules/raw';
import { tablePlugin } from './rules/table';

export function createMd(): MarkdownItType {
  const md = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  md.disable([
    'strikethrough',
    'link',
    'image',
    'autolink',
    'reference',
    'code',
    'fence',
    'blockquote',
    'hr',
    'html_block',
    'table',
    'backticks',
  ]);

  md.use(blankPlugin);
  md.use(spanPlugin);
  md.use(markPlugin);
  md.use(divPlugin);
  md.use(commentPlugin);
  md.use(rawPlugin);
  md.use(tablePlugin);

  return md;
}
