import { cn } from "../lib/utils";

/**
 * Thin drag strip centered on the seam between a left list pane and the
 * content panel to its right. Resizes the list via {@link useResizableWidth}.
 *
 * Must be a SIBLING of the panels (not nested inside the list): the list is its
 * own stacking context, so a handle inside it could never paint above the
 * opaque content panel. As a sibling anchored to a `relative` container at
 * `left: width`, its z-30 wins against the content panel's z-10. Opts out of
 * the window-drag region so dragging resizes rather than moving the window.
 */
export function ResizeHandle({
  left,
  resizing,
  onResizeStart,
  onResizeReset,
  label = "Resize list",
}: {
  /** X position of the seam (the resizable pane's current width, in px). */
  left: number;
  resizing: boolean;
  onResizeStart: (e: React.PointerEvent) => void;
  onResizeReset: () => void;
  label?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onResizeStart}
      onDoubleClick={onResizeReset}
      className="group/resize absolute top-0 bottom-0 z-30 w-3 -translate-x-1/2 cursor-col-resize"
      style={{ left, WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Grip pill — always visible; brightens on hover, turns primary while
          dragging. */}
      <span
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150",
          resizing
            ? "bg-primary"
            : "bg-border-strong group-hover/resize:bg-muted-foreground"
        )}
      />
    </div>
  );
}
