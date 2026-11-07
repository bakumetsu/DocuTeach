import type { ChatMessage } from '../api/types';

export type ContextLevel = 'ok' | 'high' | 'full';

export interface ContextUsage {
  usedChars: number;
  capChars: number;
  ratio: number;
  level: ContextLevel;
  warn: boolean;
}

// Approximation: the length of the backend's generic system prompt (backend/docuteach/llm/stream.py DEFAULT_SYSTEM); keep in step with stream.py; skill prompts are longer.
export const SYSTEM_BASE_CHARS: number = ('You are a helpful assistant for an English grammar teacher. Answer in Markdown. ' + 'For tabular content use a Markdown pipe table: header row, a `| --- |` separator row, the same number of cells in every row, one line per row, no line breaks inside a cell, write a pipe inside a cell as `\\|`.').length;

export function branchMessages(messages: ChatMessage[], replyTo: string | undefined): ChatMessage[] {
  if (!replyTo) return messages;
  const i = messages.findIndex((m) => m.id === replyTo);
  if (i === -1) return messages;
  const j = messages.findIndex((m, idx) => idx > i && m.replyTo === replyTo);
  if (j !== -1) return messages.slice(0, i + 1).concat(messages.slice(j));
  if (messages.length > i + 1) return messages.slice(0, i + 1).concat([messages[messages.length - 1]]);
  return messages.slice(0, i + 1);
}

export function contextUsage(input: {
  messages: ChatMessage[];
  refs: { name: string; text: string }[];
  draft: string;
  capChars: number;
  replyTo?: string;
}): ContextUsage {
  let usedChars = SYSTEM_BASE_CHARS;

  for (const ref of input.refs) {
    usedChars += ref.name.length + ref.text.length + 30;
  }

  for (const msg of branchMessages(input.messages, input.replyTo)) {
    usedChars += msg.content.length;
  }

  usedChars += input.draft.length;

  const ratio = input.capChars > 0 ? usedChars / input.capChars : 1;

  let level: ContextLevel;
  if (ratio >= 0.9) {
    level = 'full';
  } else if (ratio >= 0.75) {
    level = 'high';
  } else {
    level = 'ok';
  }

  return {
    usedChars,
    capChars: input.capChars,
    ratio,
    level,
    warn: ratio >= 0.9,
  };
}

export function contextTooltip(u: ContextUsage): string {
  const used = Math.round(u.usedChars / 3);
  const total = Math.round(u.capChars / 3);
  return `~${used.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} tokens`;
}
