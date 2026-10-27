export interface PageSkillRequest {
  skill: string;
  selection?: string;
  prompt: string;
  chatId: string;
}

interface PageHandlers {
  runSkill?: (r: PageSkillRequest) => boolean;
  insertFragment?: (md: string) => boolean;
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
