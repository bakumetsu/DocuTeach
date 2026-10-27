import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installGlobalKeys } from '../src/editor/globalKeys';
import { revert, redo } from '../src/editor/history';
import { saveDocument } from '../src/files/fileActions';

vi.mock('../src/editor/history', () => ({
  revert: vi.fn(),
  redo: vi.fn(),
}));

vi.mock('../src/files/fileActions', () => ({
  saveDocument: vi.fn(),
}));

describe('globalKeys', () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup = installGlobalKeys();
  });

  afterEach(() => {
    cleanup();
  });

  function dispatchKey(target: EventTarget, key: string, opts: Partial<KeyboardEventInit> = {}) {
    const ev = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    });
    target.dispatchEvent(ev);
    return ev;
  }

  it('Ctrl+Z on body calls revert', () => {
    const ev = dispatchKey(document.body, 'z', { ctrlKey: true });
    expect(revert).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Ctrl+Z on an input does NOT call revert', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const ev = dispatchKey(input, 'z', { ctrlKey: true });
    expect(revert).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    document.body.removeChild(input);
  });

  it('Ctrl+Z inside .page-content does NOT call revert', () => {
    const div = document.createElement('div');
    div.className = 'page-content';
    document.body.appendChild(div);
    const inner = document.createElement('div');
    div.appendChild(inner);
    const ev = dispatchKey(inner, 'z', { ctrlKey: true });
    expect(revert).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    document.body.removeChild(div);
  });

  it('Ctrl+S calls saveDocument and preventDefault', () => {
    const ev = dispatchKey(document.body, 's', { ctrlKey: true });
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Ctrl+Shift+Z on body calls redo', () => {
    dispatchKey(document.body, 'z', { ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(revert).not.toHaveBeenCalled();
  });

  it('Ctrl+Y on body calls redo', () => {
    dispatchKey(document.body, 'y', { ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(revert).not.toHaveBeenCalled();
  });
});
