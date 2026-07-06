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
  right,
  resizing,
  onResizeStart,
  onResizeReset,
  label = "Resize list",
}: {
  /** X position of the seam from the left (a left-docked pane's width, px). */
  left?: number;
  /** Distance from the container's right edge (a right-docked pane's width,
   *  px). Use instead of `left` for a right-docked pane so the handle sits on
   *  its inner (left) edge. */
  right?: number;
  resizing: boolean;
  onResizeStart: (e: React.PointerEvent) => void;
  onResizeReset: () => void;
  label?: string;
}) {
  const isRight = right != null;
  const style = {
    WebkitAppRegion: "no-drag",
    ...(isRight ? { right } : { left }),
  } as unknown as React.CSSProperties;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onResizeStart}
      onDoubleClick={onResizeReset}
      className={cn(
        "group/resize absolute top-0 bottom-0 z-30 w-3 cursor-col-resize",
        isRight ? "translate-x-1/2" : "-translate-x-1/2"
      )}
      style={style}
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
