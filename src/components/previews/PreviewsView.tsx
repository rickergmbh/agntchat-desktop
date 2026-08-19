import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { ResizeHandle } from "../ResizeHandle";
import {
  buildPreviewCategories,
  type PreviewCategory,
  type PreviewItem,
} from "./fixtures";

/**
 * Admin-only gallery that renders every in-conversation card component in each
 * of its states, using sample data (see fixtures.tsx). Read-only — there's no
 * create/edit; it exists so the platform's cards can be reviewed in one place
 * instead of having to drive a real task/artifact/thread to see them.
 *
 * Layout mirrors TemplatesView: a category list on the left, a scrolling
 * gallery of that category's states on the right.
 */
export function PreviewsView() {
  const { t } = useTranslation("previews");
  const myId = useAuthStore((s) => s.participant?.id);

  // Rebuild only when identity changes (keeps fixture keys stable across
  // renders so cards with local expand state don't remount).
  const categories = useMemo(() => buildPreviewCategories(myId), [myId]);

  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [categories, search]);

  const selected =
    categories.find((c) => c.id === selectedId) ?? filtered[0] ?? categories[0];

  const { width, ref, resizing, onResizeStart, onResizeReset } =
    useResizableWidth({
      storageKey: "agentchat:previewListWidth",
      defaultWidth: 300,
      min: 240,
      max: 440,
    });

  return (
    <div className="relative flex-1 flex h-full overflow-hidden bg-canvas">
      <aside
        ref={ref}
        className="relative z-0 shrink-0 flex flex-col bg-canvas"
        style={{ width, WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className="h-14 shrink-0 px-4 border-b border-border flex items-center gap-2"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <h2 className="text-sm font-semibold text-foreground">{t("title")}</h2>
        </div>

        <div
          className="px-3 py-2 border-b border-border"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto pt-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {filtered.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              active={category.id === selected?.id}
              statesLabel={t("states", { count: category.items.length })}
              onClick={() => setSelectedId(category.id)}
            />
          ))}
        </div>
      </aside>

      <ResizeHandle
        left={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
      />

      <section className="relative z-10 -ml-2 flex-1 flex flex-col bg-card overflow-hidden surface-panel rounded-l-2xl">
        {selected ? (
          <>
            <header className="px-6 py-3 border-b border-border bg-card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {selected.name}
                </h3>
                <p className="text-xs text-muted-foreground truncate">
                  {selected.description}
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                {t("readOnly")}
              </Badge>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5 bg-canvas">
              <div className="mx-auto flex max-w-3xl flex-col gap-6">
                {selected.items.map((item, i) => (
                  <PreviewTile key={`${selected.id}-${i}`} item={item} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        )}
      </section>
    </div>
  );
}

function CategoryRow({
  category,
  active,
  statesLabel,
  onClick,
}: {
  category: PreviewCategory;
  active: boolean;
  statesLabel: string;
  onClick: () => void;
}) {
  const Icon = category.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-[calc(100%-1rem)] mx-2 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
        active ? "bg-surface-active shadow-sm" : "hover:bg-surface-hover"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{category.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[9px] px-1 py-0">
            {statesLabel}
          </Badge>
        </div>
      </div>
    </button>
  );
}

const swallowClick = (e: React.MouseEvent) => {
  // Non-interactive previews: neutralize navigation / mutation clicks (open
  // viewer, open thread, stop task) while keeping hover styles intact.
  e.preventDefault();
  e.stopPropagation();
};

function PreviewTile({ item }: { item: PreviewItem }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2 px-1">
        <span className="text-xs font-semibold text-foreground">
          {item.label}
        </span>
        {item.caption && (
          <span className="text-[11px] text-muted-foreground">
            {item.caption}
          </span>
        )}
      </div>
      {/* A slice of a conversation: cards render on the chat background exactly
          as they would in a thread. */}
      <div className="rounded-xl border border-border bg-background py-2 shadow-sm">
        {item.interactive ? (
          item.node
        ) : (
          <div onClickCapture={swallowClick} className="[&_a]:cursor-default">
            {item.node}
          </div>
        )}
      </div>
    </div>
  );
}
