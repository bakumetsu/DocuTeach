import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/editor/extensions';
import { PageBreaks, pageBreaksKey } from '../src/editor/pageBreaksPlugin';

// Fake layout: every block is LINE px per 60 chars (min 1 line); spacer height from --pb-rem.
const LINE = 30;
function installLayout(root: HTMLElement) {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    // layout all top-level children of root sequentially
    const kids = Array.from(root.children) as HTMLElement[];
    const h = (k: HTMLElement) => {
      if (k.classList.contains('page-break-spacer')) {
        const rem = parseFloat(k.style.getPropertyValue('--pb-rem')) || 0;
        return rem + 45 + 24 + 45;
      }
      return Math.max(1, Math.ceil((k.textContent ?? '').length / 60)) * LINE;
    };
    if (this === root) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    let y = 0;
    for (const k of kids) {
      const kh = h(k);
      if (k === this || k.contains(this)) return { top: y, bottom: y + kh, left: 0, right: 0, width: 0, height: kh, x: 0, y, toJSON() {} } as DOMRect;
      y += kh;
    }
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
}

describe('page split input', () => {
  let editor: Editor | undefined;
  afterEach(() => { editor?.destroy(); document.body.innerHTML = ''; });

  it('typing spaces across the page break keeps every letter and transaction', async () => {
    const page = document.createElement('div');
    page.className = 'page';
    page.style.paddingTop = '45px';
    page.style.paddingBottom = '45px';
    document.body.appendChild(page);
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() { return document.body; }, configurable: true });
    const raf: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const paras = Array.from({ length: 30 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `p${i} ` + 'x'.repeat(100) }] }));
    editor = new Editor({ element: page, extensions: [...extensions, PageBreaks], content: { type: 'doc', content: paras } });
    installLayout(editor.view.dom);
    const flush = () => { let n = 0; while (raf.length && n++ < 50) raf.splice(0).forEach((cb) => cb(0)); return n; };
    flush();
    const s0 = pageBreaksKey.getState(editor.state);
    expect(s0.breaks.length).toBeGreaterThan(0);
    // type spaces at the end of the paragraph just before the first break
    const target = s0.breaks[0].pos;
    editor.commands.setTextSelection(target - 1);
    for (let i = 0; i < 80; i++) {
      editor.view.dispatch(editor.state.tr.insertText(' '));
      const loops = flush();
      expect(loops).toBeLessThan(50);
    }
    expect(editor.state.doc.textContent).toContain(' '.repeat(80));
    // delete and new content still work
    editor.commands.setContent('<p>new</p>');
    expect(editor.state.doc.textContent).toBe('new');
  });
});
