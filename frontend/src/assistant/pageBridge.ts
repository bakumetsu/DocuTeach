import type { EditScope } from '../api/types';

export interface PageSkillRequest {
  skill: string;
  selection?: string;
  prompt: string;
  chatId: string;
}

export interface PageEditRequest {
  instruction: string;
  scope: EditScope;
  allowProtected: boolean;
  onReply?: (text: string) => void;
}

interface PageHandlers {
  runSkill?: (r: PageSkillRequest) => boolean;
  insertFragment?: (md: string) => boolean;
  runEdit?: (r: PageEditRequest) => boolean;
}

let handlers: PageHandlers = {};

export function setPageHandlers(h: PageHandlers): void {
  handlers = h;
}

export function runPageSkill(r: PageSkillRequest): boolean {
  if (!handlers.runSkill) return false;
  return handlers.runSkill(r);
}

export function insertFromChat(md: string): boolean {
  if (!handlers.insertFragment) return false;
  return handlers.insertFragment(md);
}

export function runPageEdit(r: PageEditRequest): boolean {
  if (!handlers.runEdit) return false;
  return handlers.runEdit(r);
}
