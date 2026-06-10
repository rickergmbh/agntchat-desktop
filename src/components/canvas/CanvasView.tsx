import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Lock,
  Search,
  BookOpen,
  Loader2,
  Plus,
  AlertCircle,
} from "lucide-react";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "../../lib/utils";
import type { CanvasDefinitionSummary } from "../../lib/api";
import { useCanvasStore } from "../../stores/canvasStore";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { ResizeHandle } from "../ResizeHandle";
import { CanvasEditor } from "./CanvasEditor";

const DOCS_URL = "https://github.com/jricker/AgentGram";

function openExternal(url: string) {
  tauriOpen(url).catch(() => window.open(url, "_blank"));
}

export function CanvasView() {
  const definitions = useCanvasStore((s) => s.definitions);
  const loading = useCanvasStore((s) => s.loading);
  const loadedAt = useCanvasStore((s) => s.loadedAt);
  const error = useCanvasStore((s) => s.error);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const details = useCanvasStore((s) => s.details);
  const detailLoading = useCanvasStore((s) => s.detailLoading);
  const fetchDefinitions = useCanvasStore((s) => s.fetchDefinitions);
  const selectCanvas = useCanvasStore((s) => s.selectCanvas);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (loadedAt === 0) fetchDefinitions();
  }, [loadedAt, fetchDefinitions]);

  const { owned, builtin } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q
      ? definitions
      : definitions.filter(
          (d) =>
            d.name.toLowerCase().includes(q) ||
            (d.description ?? "").toLowerCase().includes(q)
        );
    return {
      owned: filtered.filter((d) => !d.isBuiltin),
      builtin: filtered.filter((d) => d.isBuiltin),
    };
  }, [definitions, search]);

  const isNew = selectedId === "new";
  const selectedSummary = useMemo(
    () =>
      selectedId && selectedId !== "new"
        ? definitions.find((d) => d.id === selectedId) ?? null
        : null,
    [definitions, selectedId]
  );
  const selectedDetail =
    selectedId && selectedId !== "new" ? details[selectedId] : undefined;
  const selectedLoading =
    selectedId && selectedId !== "new" ? detailLoading[selectedId] : false;

  // The editor needs the full `definition` JSON — once the detail has been
  // fetched, merge it over the summary so the editor has both metadata + body.
  const selectedForEditor: CanvasDefinitionSummary | null = useMemo(() => {
    if (!selectedSummary) return null;
    if (selectedDetail?.definition) return selectedDetail;
    return selectedSummary;
  }, [selectedSummary, selectedDetail]);

  const { width, ref, resizing, onResizeStart, onResizeReset } =
    useResizableWidth({
      storageKey: "agentchat:canvasListWidth",
      defaultWidth: 320,
      min: 240,
      max: 480,
    });

  return (
    // Recessed canvas; the editor column floats over the list as a rounded
    // panel lapping left — same layered overlap as the chat view.
    <div className="relative flex-1 flex h-full overflow-hidden bg-canvas">
      <aside
        ref={ref}
        className="relative z-0 shrink-0 flex flex-col bg-canvas"
        style={{ width, WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div
          className="h-14 shrink-0 px-4 border-b border-border flex items-center justify-between"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
              <LayoutDashboard className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Canvases</h2>
          </div>
          <button
            type="button"
            onClick={() => selectCanvas("new")}
            title="New canvas"
            aria-label="New canvas"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div
          className="px-3 py-2 border-b border-border"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search canvases..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {error && definitions.length === 0 && (
          <div
            className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => fetchDefinitions()}
                className="mt-1 text-[11px] text-destructive underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div
          className="flex-1 overflow-y-auto"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {loading && definitions.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : definitions.length === 0 ? (
            <EmptyList onCreate={() => selectCanvas("new")} />
          ) : (
            <>
              {owned.length > 0 && (
                <SectionHeader label="Your Canvases" count={owned.length} />
              )}
              {owned.map((d) => (
                <CanvasRow
                  key={d.id}
                  canvas={d}
                  active={d.id === selectedId}
                  onClick={() => selectCanvas(d.id)}
                />
              ))}
              {builtin.length > 0 && (
                <SectionHeader label="Built-in" count={builtin.length} />
              )}
              {builtin.map((d) => (
                <CanvasRow
                  key={d.id}
                  canvas={d}
                  active={d.id === selectedId}
                  onClick={() => selectCanvas(d.id)}
                />
              ))}
            </>
          )}
        </div>
      </aside>

      <ResizeHandle
        left={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label="Resize canvas list"
      />

      <section className="relative z-10 -ml-2 flex-1 flex flex-col bg-card overflow-hidden surface-panel rounded-l-2xl">
        <header className="px-6 py-3 border-b border-border bg-card flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => openExternal(DOCS_URL)}
            title="Open documentation"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Docs
          </Button>
        </header>

        {isNew ? (
          <CanvasEditor key="new" canvas={null} isNew />
        ) : selectedForEditor ? (
          selectedLoading && !selectedDetail ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <CanvasEditor
              key={selectedForEditor.id}
              canvas={selectedForEditor}
              isNew={false}
            />
          )
        ) : (
          <EmptyDetail onCreate={() => selectCanvas("new")} />
        )}
      </section>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="px-3 pb-1 pt-3 flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground/60">{count}</span>
    </div>
  );
}

function CanvasRow({
  canvas,
  active,
  onClick,
}: {
  canvas: CanvasDefinitionSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors border-b border-border",
        active ? "bg-primary/5" : "hover:bg-muted/50"
      )}
    >
      <LayoutDashboard className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{canvas.name}</p>
          {canvas.isBuiltin && (
            <Lock className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge
            variant="secondary"
            className={cn(
              "text-[9px] px-1 py-0",
              canvas.isPublished && !canvas.isBuiltin
                ? "bg-success/10 text-success border-success/30"
                : ""
            )}
          >
            {canvas.isBuiltin
              ? "Built-in"
              : canvas.isPublished
              ? "Published"
              : "Draft"}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            v{canvas.version}
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyDetail({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <LayoutDashboard className="w-12 h-12 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-foreground">Select a canvas</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">
        Pick one from the left, or start a new one.
      </p>
      <Button size="sm" onClick={onCreate} className="mt-4">
        <Plus className="mr-1.5 h-3 w-3" />
        Create Canvas
      </Button>
    </div>
  );
}

function EmptyList({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <LayoutDashboard className="w-10 h-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">No canvases yet</p>
      <Button size="sm" onClick={onCreate} className="mt-3">
        <Plus className="mr-1.5 h-3 w-3" />
        Create Canvas
      </Button>
    </div>
  );
}
