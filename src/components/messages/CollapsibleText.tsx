import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/utils";

/** Height a long message is clamped to while collapsed (~13 lines of body
 *  text at the bubble's 14px/1.625 leading). */
const COLLAPSED_MAX_PX = 240;
/** Only clamp when doing so actually hides something worth hiding — a
 *  message a couple of lines over the cap would spend more room on the
 *  toggle than the clamp saves. */
const MIN_HIDDEN_PX = 120;

/** Soft cut at the bottom of a collapsed block. A mask (rather than a
 *  gradient overlay) keeps this independent of the bubble's background, so
 *  own/agent/other variants and both themes all fade correctly. */
const FADE = "linear-gradient(to bottom, #000 calc(100% - 3rem), transparent)";

/**
 * Clamps very long message bodies behind a "Read more" toggle so one
 * essay-length message can't swallow the thread (WhatsApp-style).
 * Wraps the text body only — attachments, reactions and the timestamp stay
 * outside the clamp.
 */
export function CollapsibleText({ children }: { children: ReactNode }) {
  const { t } = useTranslation("chat");
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // The clamp lives on the wrapper, so the inner element always reports its
  // natural height — measuring it never fights the max-height above it.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () =>
      setOverflows(el.offsetHeight > COLLAPSED_MAX_PX + MIN_HIDDEN_PX);
    measure();
    // Markdown reflows after mount (fonts, images, window/pane resize), so
    // re-measure rather than trusting the first pass.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const collapsed = overflows && !expanded;

  return (
    <div>
      <div
        className={cn(collapsed && "overflow-hidden")}
        style={
          collapsed
            ? {
                maxHeight: COLLAPSED_MAX_PX,
                maskImage: FADE,
                WebkitMaskImage: FADE,
              }
            : undefined
        }
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-0.5 text-xs font-medium opacity-80 transition-opacity hover:opacity-100"
        >
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {expanded ? t("longMessage.showLess") : t("longMessage.readMore")}
        </button>
      )}
    </div>
  );
}
