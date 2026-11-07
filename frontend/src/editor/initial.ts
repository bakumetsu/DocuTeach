import { api } from '../api/index';
import { useApp } from '../state/store';

export async function loadInitialMarkdown(): Promise<string> {
  const rec = await api.docs.load(useApp.getState().lessonId);
  if (rec) return rec.markdown;
  try {
    const res = await fetch('/sample/lesson.md');
    return await res.text();
  } catch {
    return '# New lesson\n';
  }
}
