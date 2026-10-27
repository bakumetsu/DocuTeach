import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import App from '../src/App';
import { useApp } from '../src/state/store';

const lessonText = readFileSync('public/sample/lesson.md', 'utf-8');

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/sample/lesson.md') {
        return { ok: true, text: async () => lessonText };
      }
      return { ok: false, text: async () => '' };
    }),
  );
  localStorage.clear();
});

afterEach(cleanup);

describe('PreviewPane smoke', () => {
  it('student view hides notes, shows blanks; teacher view shows notes', async () => {
    render(<App />);

    // Wait for initial load
    await waitFor(() => {
      expect(document.querySelector('.page-content')).not.toBeNull();
    });

    // Switch to student view
    act(() => {
      useApp.getState().setView('student');
    });

    await waitFor(() => {
      expect(document.querySelector('.page.view-student')).not.toBeNull();
    });

    // Student assertions — scoped to the student preview container
    const student = document.querySelector('.page.view-student')!;
    await waitFor(() => {
      expect(student.querySelectorAll('.blank-line').length).toBeGreaterThan(0);
      expect(student.querySelectorAll('.note').length).toBe(0);
      const bodyText = student.textContent ?? '';
      expect(bodyText).not.toContain("'s lived");
      const pageContent = student.querySelector('.page-content');
      expect(pageContent?.textContent).toContain('Present Perfect');
    });

    // Switch to teacher view
    act(() => {
      useApp.getState().setView('teacher');
    });

    await waitFor(() => {
      expect(document.querySelector('.page.view-teacher')).not.toBeNull();
    });

    // Teacher assertions — scoped to the teacher preview container
    const teacher = document.querySelector('.page.view-teacher')!;
    await waitFor(() => {
      expect(teacher.querySelectorAll('.note').length).toBeGreaterThan(0);
      const bodyText = teacher.textContent ?? '';
      expect(bodyText).toContain("'s lived");
    });

    // Switch back to edit
    act(() => {
      useApp.getState().setView('edit');
    });

    await waitFor(() => {
      expect(document.querySelector('.page.view-edit')).not.toBeNull();
      expect(document.querySelector('.page-content')).not.toBeNull();
    });
  });
});
