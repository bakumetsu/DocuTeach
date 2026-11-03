import { useCallback, useEffect, type ReactNode } from 'react';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react-dom';

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  menuNav?: boolean;
  children: ReactNode;
}

export function Popover({ anchor, open, onClose, menuNav = false, children }: PopoverProps) {
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-start',
    middleware: [offset(6), flip(), shift()],
    whileElementsMounted: autoUpdate,
    elements: { reference: anchor },
  });

  const setFloating = useCallback(
    (n: HTMLDivElement | null) => {
      refs.setFloating(n);
    },
    [refs],
  );

  // Focus first menuitem when menuNav popover opens
  useEffect(() => {
    if (!menuNav || !open) return;
    const el = refs.floating.current;
    if (el) {
      const first = el.querySelector<HTMLButtonElement>('[role="menuitem"]');
      if (first) first.focus();
    }
  }, [menuNav, open, refs]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!menuNav) return;
    const el = refs.floating.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    const activeIdx = items.findIndex((item) => item === document.activeElement);
    let next: number;
    switch (e.key) {
      case 'ArrowDown':
        next = (activeIdx + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (activeIdx - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    items[next].focus();
  }, [menuNav, refs]);

  // Close on Escape / outside click
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        if (menuNav) anchor?.focus();
      }
    };

    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (refs.floating.current && !refs.floating.current.contains(target)) {
        if (!anchor?.contains(target)) {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose, anchor, refs, menuNav]);

  if (!open) return null;

  return (
    <div ref={setFloating} className="popover" style={floatingStyles} onKeyDown={handleMenuKeyDown}>
      {children}
    </div>
  );
}
