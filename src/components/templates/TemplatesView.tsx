import { useEffect, useMemo, useState } from "react";
import {
  FileText,
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
import type { ResponseTemplate } from "../../lib/api";
import { useTemplateStore } from "../../stores/templateStore";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { ResizeHandle } from "../ResizeHandle";
import { TemplateEditor, TemplatesEmptyState } from "./TemplateEditor";

const DOCS_URL = "https://github.com/jricker/AgentGram";

function openExternal(url: string) {
  tauriOpen(url).catch(() => window.open(url, "_blank"));
}

export function TemplatesView() {
  const templates = useTemplateStore((s) => s.templates);
  const loading = useTemplateStore((s) => s.loading);
  const loadedAt = useTemplateStore((s) => s.loadedAt);
  const error = useTemplateStore((s) => s.error);
  const selectedId = useTemplateStore((s) => s.selectedId);
  const fetchTemplates = useTemplateStore((s) => s.fetchTemplates);
  const selectTemplate = useTemplateStore((s) => s.selectTemplate);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (loadedAt === 0) fetchTemplates();
  }, [loadedAt, fetchTemplates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        t.resultType.toLowerCase().includes(q)
    );
  }, [templates, search]);

  const isNew = selectedId === "new";
  const selected = useMemo(
    () =>
      selectedId && selectedId !== "new"
        ? templates.find((t) => t.id === selectedId) ?? null
        : null,
    [templates, selectedId]
  );

  const { width, ref, resizing, onResizeStart, onResizeReset } =
    useResizableWidth({
      storageKey: "agentchat:templateListWidth",
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
        style={
          { width, WebkitAppRegion: "drag" } as React.CSSProperties
        }
      >
        <div
          className="h-14 shrink-0 px-4 border-b border-border flex items-center justify-between"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
              <FileText className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">Templates</h2>
          </div>
          <button
            type="button"
            onClick={() => selectTemplate("new")}
            title="New template"
            aria-label="New template"
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
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        {error && templates.length === 0 && (
          <div
            className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-3 py-2"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => fetchTemplates()}
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
          {loading && templates.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <EmptyList onCreate={() => selectTemplate("new")} />
          ) : (
            <div className="pt-2">
              {filtered.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  active={t.id === selectedId}
                  onClick={() => selectTemplate(t.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <ResizeHandle
        left={width}
        resizing={resizing}
        onResizeStart={onResizeStart}
        onResizeReset={onResizeReset}
        label="Resize template list"
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

        {isNew || selected ? (
          <TemplateEditor
            key={isNew ? "new" : selected!.id}
            template={isNew ? null : selected}
            isNew={isNew}
          />
        ) : (
          <TemplatesEmptyState onCreate={() => selectTemplate("new")} />
        )}
      </section>
    </div>
  );
}

function TemplateRow({
  template,
  active,
  onClick,
}: {
  template: ResponseTemplate;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-[calc(100%-1rem)] mx-2 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
        active ? "bg-surface-active shadow-sm" : "hover:bg-surface-hover"
      )}
    >
      <FileText className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium font-mono">
          {template.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Badge variant="secondary" className="text-[9px] px-1 py-0">
            {template.resultType}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {template.fields.length} field
            {template.fields.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyList({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <FileText className="w-10 h-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">No templates yet</p>
      <Button size="sm" onClick={onCreate} className="mt-3">
        <Plus className="mr-1.5 h-3 w-3" />
        Create Template
      </Button>
    </div>
  );
}
