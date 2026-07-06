import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize for a left list pane. Returns the current width, a ref to put
 * on the resizable element (its left edge is the measurement origin), and the
 * handlers a {@link ResizeHandle} consumes.
 *
 * Each call persists to its own localStorage key, so different views (chat,
 * tasks, templates, canvas) remember their list widths independently. Width is
 * clamped to [min, max]; double-click on the handle snaps back to `defaultWidth`.
 */
export interface ResizableWidth {
  /** Current pane width in px. Apply via `style={{ width }}`. */
  width: number;
  /** Put on the resizable element — its left edge is the drag origin. */
  ref: React.RefObject<HTMLElement | null>;
  /** True while a drag is in flight (for grip styling). */
  resizing: boolean;
  /** `onPointerDown` for the handle. */
  onResizeStart: (e: React.PointerEvent) => void;
  /** `onDoubleClick` for the handle — resets to the default width. */
  onResizeReset: () => void;
}

export function useResizableWidth({
  storageKey,
  defaultWidth,
  min,
  max,
  side = "left",
}: {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** Which edge the pane is docked to. `"left"` (default) grows rightward
   *  from the pane's left edge (list panes); `"right"` grows leftward from the
   *  pane's right edge (right-docked panes like the thread side pane), so
   *  dragging the left handle outward widens it. */
  side?: "left" | "right";
}): ResizableWidth {
  const clamp = useCallback(
    (px: number) => Math.max(min, Math.min(max, px)),
    [min, max]
  );

  const [width, setWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
      }
    } catch {}
    return defaultWidth;
  });

  const [resizing, setResizing] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // Track the pointer globally while a drag is in flight so the handle keeps
  // following even if the cursor outruns the thin grip. Width is the pointer's
  // X relative to the pane's left edge. While resizing we set a body cursor +
  // disable text selection for a clean drag feel.
  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const right = rect?.right ?? 0;

      const onMove = (ev: PointerEvent) => {
        // Left-docked: width = pointer distance from the left edge. Right-docked:
        // width = distance from the right edge (pointer moving left widens it).
        setWidth(clamp(side === "right" ? right - ev.clientX : ev.clientX - left));
      };
      const onUp = () => {
        setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clamp, side]
  );

  const onResizeReset = useCallback(() => {
    setWidth(defaultWidth);
  }, [defaultWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {}
  }, [storageKey, width]);

  return { width, ref, resizing, onResizeStart, onResizeReset };
}
