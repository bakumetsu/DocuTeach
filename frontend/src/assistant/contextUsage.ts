import type { ChatMessage } from '../api/types';

export type ContextLevel = 'ok' | 'high' | 'full';

export interface ContextUsage {
  usedChars: number;
  capChars: number;
  ratio: number;
  level: ContextLevel;
  warn: boolean;
}

// Approximation: the length of the backend's generic system prompt (backend/docuteach/llm/stream.py build_messages); skill prompts are longer.
export const SYSTEM_BASE_CHARS: number = 'You are a helpful assistant for an English grammar teacher. Answer in Markdown.'.length;

export function contextUsage(input: {
  messages: ChatMessage[];
  refs: { name: string; text: string }[];
  draft: string;
  capChars: number;
}): ContextUsage {
  let usedChars = SYSTEM_BASE_CHARS;

  for (const ref of input.refs) {
    usedChars += ref.name.length + ref.text.length + 30;
  }

  for (const msg of input.messages) {
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

export function contextTooltip(u: ContextUsage, estimated: boolean, nCtx: number | null): string {
  const used = u.usedChars.toLocaleString('en-US');
  const cap = u.capChars.toLocaleString('en-US');
  const pct = Math.round(u.ratio * 100);
  let result = `Context: ${used} of ${cap} characters (${pct}%)`;
  if (estimated) {
    result += ' · estimate (about 3 characters per token)';
  }
  if (nCtx != null) {
    result += ` · model window ${nCtx} tokens per chat`;
  }
  return result;
}
