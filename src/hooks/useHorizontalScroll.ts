import { useRef, useCallback, useState } from "react";

export function useHorizontalScroll<T extends HTMLElement>() {
  const scrollRef = useRef<T>(null);
  const isPointerDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollStartRef = useRef(0);
  const didDragRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  // Mouse Drag-to-Scroll (Touch / Click & Drag swipe with pointer capture)
  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    // Only primary mouse button (left-click) or touch
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;

    isPointerDownRef.current = true;
    startXRef.current = e.pageX;
    scrollStartRef.current = el.scrollLeft;
    didDragRef.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    if (!isPointerDownRef.current) return;
    const el = scrollRef.current;
    if (!el) return;

    const dx = e.pageX - startXRef.current;
    if (!didDragRef.current && Math.abs(dx) > 5) {
      didDragRef.current = true;
      setIsDragging(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    }

    if (didDragRef.current) {
      el.scrollLeft = scrollStartRef.current - dx;
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<T>) => {
    if (isPointerDownRef.current) {
      isPointerDownRef.current = false;
      const el = scrollRef.current;
      if (el) {
        try {
          if (el.hasPointerCapture(e.pointerId)) {
            el.releasePointerCapture(e.pointerId);
          }
        } catch {}
      }
      setIsDragging(false);

      // Keep didDragRef true for a short tick so onClickCapture intercepts the card click
      setTimeout(() => {
        didDragRef.current = false;
      }, 60);
    }
  }, []);

  const onPointerCancel = useCallback((e: React.PointerEvent<T>) => {
    isPointerDownRef.current = false;
    const el = scrollRef.current;
    if (el) {
      try {
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
    setIsDragging(false);
    setTimeout(() => {
      didDragRef.current = false;
    }, 60);
  }, []);

  // Suppress accidental card click when user was dragging the row
  const onClickCapture = useCallback((e: React.MouseEvent<T>) => {
    if (didDragRef.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return {
    scrollRef,
    isDragging,
    dragProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
