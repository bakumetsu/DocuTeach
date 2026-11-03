import { useApp } from '../state/store';
import { useChats } from './chatStore';

export function replyWithSelection(text: string): void {
  useApp.getState().setAssistantCollapsed(false);
  useChats.getState().quoteIntoInput(text);
}
