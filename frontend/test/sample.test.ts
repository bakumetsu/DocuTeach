import { test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const LESSON = resolve(process.cwd(), 'public/sample/lesson.md');

test('public/sample/lesson.md exists and has expected structure', () => {
  expect(existsSync(LESSON)).toBe(true);

  const content = readFileSync(LESSON, 'utf8');

  expect(content.startsWith('---\n')).toBe(true);
  expect(content.endsWith('\n')).toBe(true);
  expect(content.endsWith('\n\n')).toBe(false);

  expect(content).toContain('::: teacher');
  expect(content).toContain('{{');
  expect(content).toContain('<!-- split:');
});
