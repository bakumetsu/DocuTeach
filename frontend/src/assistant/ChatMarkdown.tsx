import React, { useMemo } from 'react';
import type { MarkdownIt as MarkdownItType } from 'markdown-it';
import { createChatMd } from '../markdown/md';

type Tok = ReturnType<MarkdownItType['parse']>[number];

const md = createChatMd();
const MAX_BODY_ROWS = 200;
const MAX_COLS = 12;

function renderInline(children: readonly Tok[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < children.length) {
    const t = children[i];
    switch (t.type) {
      case 'text':
        out.push(t.content);
        i++;
        break;
      case 'softbreak':
        out.push('\n');
        i++;
        break;
      case 'hardbreak':
        out.push(<br key={i} />);
        i++;
        break;
      case 'strong_open': {
        const [nodes, ni] = renderInlinePair(children, i + 1, 'strong_close');
        out.push(<strong key={i}>{nodes}</strong>);
        i = ni;
        break;
      }
      case 'em_open': {
        const [nodes, ni] = renderInlinePair(children, i + 1, 'em_close');
        out.push(<em key={i}>{nodes}</em>);
        i = ni;
        break;
      }
      case 'code_inline':
        out.push(<code key={i}>{t.content}</code>);
        i++;
        break;
      default:
        if (t.content) out.push(t.content);
        i++;
        break;
    }
  }
  return out;
}

function renderInlinePair(
  children: readonly Tok[],
  i: number,
  stopType: string,
): [React.ReactNode[], number] {
  const out: React.ReactNode[] = [];
  while (i < children.length) {
    const t = children[i];
    if (t.type === stopType) {
      i++;
      break;
    }
    switch (t.type) {
      case 'text':
        out.push(t.content);
        i++;
        break;
      case 'softbreak':
        out.push('\n');
        i++;
        break;
      case 'hardbreak':
        out.push(<br key={i} />);
        i++;
        break;
      case 'strong_open': {
        const [nodes, ni] = renderInlinePair(children, i + 1, 'strong_close');
        out.push(<strong key={i}>{nodes}</strong>);
        i = ni;
        break;
      }
      case 'em_open': {
        const [nodes, ni] = renderInlinePair(children, i + 1, 'em_close');
        out.push(<em key={i}>{nodes}</em>);
        i = ni;
        break;
      }
      case 'code_inline':
        out.push(<code key={i}>{t.content}</code>);
        i++;
        break;
      default:
        if (t.content) out.push(t.content);
        i++;
        break;
    }
  }
  return [out, i];
}

function renderTable(tokens: readonly Tok[], i: number): [React.ReactNode, number] {
  // i points at table_open; consume it
  i++;
  const headerCells: React.ReactNode[] = [];
  const bodyRows: React.ReactNode[][] = [];
  let totalBodyRows = 0;

  while (i < tokens.length && tokens[i].type !== 'table_close') {
    const t = tokens[i];
    if (t.type === 'thead_open') {
      i++; // skip thead_open
      if (i < tokens.length && tokens[i].type === 'tr_open') {
        i++; // skip tr_open
        while (i < tokens.length && tokens[i].type !== 'tr_close') {
          if (tokens[i].type === 'th_open') {
            i++; // skip th_open
            if (i < tokens.length && tokens[i].type === 'inline') {
              const nodes = renderInline(tokens[i].children ?? []);
              headerCells.push(React.createElement(React.Fragment, { key: headerCells.length }, nodes));
              i++;
            }
            if (i < tokens.length && tokens[i].type === 'th_close') i++;
          } else {
            i++;
          }
        }
      }
      if (i < tokens.length && tokens[i].type === 'tr_close') i++;
      if (i < tokens.length && tokens[i].type === 'thead_close') i++;
    } else if (t.type === 'tbody_open') {
      i++; // skip tbody_open
      while (i < tokens.length && tokens[i].type !== 'tbody_close') {
        if (tokens[i].type === 'tr_open') {
          i++; // skip tr_open
          const row: React.ReactNode[] = [];
          while (i < tokens.length && tokens[i].type !== 'tr_close') {
            if (tokens[i].type === 'td_open') {
              i++; // skip td_open
              if (i < tokens.length && tokens[i].type === 'inline') {
                const nodes = renderInline(tokens[i].children ?? []);
                row.push(React.createElement(React.Fragment, { key: row.length }, nodes));
                i++;
              }
              if (i < tokens.length && tokens[i].type === 'td_close') i++;
            } else {
              i++;
            }
          }
          if (i < tokens.length && tokens[i].type === 'tr_close') i++;
          totalBodyRows++;
          bodyRows.push(row);
        } else {
          i++;
        }
      }
      if (i < tokens.length && tokens[i].type === 'tbody_close') i++;
    } else {
      i++;
    }
  }
  if (i < tokens.length && tokens[i].type === 'table_close') i++;

  const visibleCols = Math.min(headerCells.length, MAX_COLS);
  const visibleHeader = headerCells.slice(0, visibleCols);
  const visibleBody = bodyRows.slice(0, MAX_BODY_ROWS);
  const droppedRows = totalBodyRows - visibleBody.length;

  const el = (
    <div className="chat-table-wrap">
      <table className="chat-table">
        <thead>
          <tr>
            {visibleHeader.map((cell, ci) => (
              <th key={ci}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleBody.map((row, ri) => (
            <tr key={ri}>
              {row.slice(0, visibleCols).map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
          {droppedRows > 0 && (
            <tr>
              <td colSpan={visibleCols} className="chat-table-more">
                {'\u2026 ' + droppedRows + ' more rows'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return [el, i];
}

function renderBlock(tokens: readonly Tok[], i: number): [React.ReactNode[], number] {
  const out: React.ReactNode[] = [];
  while (i < tokens.length) {
    const t = tokens[i];
    switch (t.type) {
      case 'paragraph_open': {
        i++;
        if (i < tokens.length && tokens[i].type === 'inline') {
          const nodes = renderInline(tokens[i].children ?? []);
          out.push(<p key={i}>{nodes}</p>);
          i++;
        }
        if (i < tokens.length && tokens[i].type === 'paragraph_close') i++;
        break;
      }
      case 'heading_open': {
        const tag = t.tag as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        i++;
        if (i < tokens.length && tokens[i].type === 'inline') {
          const nodes = renderInline(tokens[i].children ?? []);
          out.push(React.createElement(tag, { key: i, className: 'chat-h' }, nodes));
          i++;
        }
        if (i < tokens.length && tokens[i].type === 'heading_close') i++;
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const key = i;
        const Tag = t.type === 'bullet_list_open' ? 'ul' : 'ol';
        i++;
        const [items, ni] = renderBlock(tokens, i);
        out.push(React.createElement(Tag, { key }, items));
        i = ni;
        if (i < tokens.length && (tokens[i].type === 'bullet_list_close' || tokens[i].type === 'ordered_list_close')) i++;
        break;
      }
      case 'list_item_open': {
        const key = i;
        i++;
        const [content, ni] = renderBlock(tokens, i);
        out.push(<li key={key}>{content}</li>);
        i = ni;
        if (i < tokens.length && tokens[i].type === 'list_item_close') i++;
        break;
      }
      case 'blockquote_open': {
        const key = i;
        i++;
        const [inner, ni] = renderBlock(tokens, i);
        out.push(<blockquote key={key}>{inner}</blockquote>);
        i = ni;
        if (i < tokens.length && tokens[i].type === 'blockquote_close') i++;
        break;
      }
      case 'hr': {
        const key = i;
        out.push(<hr key={key} />);
        i++;
        break;
      }
      case 'fence_open': {
        const key = i;
        i++;
        let code = '';
        if (i < tokens.length && tokens[i].type === 'text') {
          code = tokens[i].content;
          i++;
        }
        if (i < tokens.length && tokens[i].type === 'fence_close') i++;
        out.push(
          <pre className="chat-pre" key={key}>
            <code>{code}</code>
          </pre>,
        );
        break;
      }
      case 'code_block': {
        const key = i;
        out.push(
          <pre className="chat-pre" key={key}>
            <code>{t.content}</code>
          </pre>,
        );
        i++;
        break;
      }
      case 'table_open': {
        const [el, ni] = renderTable(tokens, i);
        out.push(React.createElement(React.Fragment, { key: i }, el));
        i = ni;
        break;
      }
      default: {
        if (t.content) out.push(t.content);
        i++;
        break;
      }
    }
  }
  return [out, i];
}

export const ChatMarkdown = React.memo(function ChatMarkdown({ text }: { text: string }) {
  const children = useMemo(() => {
    const tokens = md.parse(text, {});
    const [nodes] = renderBlock(tokens, 0);
    return nodes;
  }, [text]);

  return <>{children}</>;
});
