import { useCallback, useEffect, type ReactNode } from 'react';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react-dom';

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function Popover({ anchor, open, onClose, children }: PopoverProps) {
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

  // Close on Escape / outside click
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
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
  }, [open, onClose, anchor, refs]);

  if (!open) return null;

  return (
    <div ref={setFloating} className="popover" style={floatingStyles}>
      {children}
    </div>
  );
}
