import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { type ResponseTemplate, listResponseTemplates } from "../lib/api";
import { TemplateCardPreview } from "./TemplateCardPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LayoutTemplate,
  X,
  ChevronRight,
} from "lucide-react";

interface Props {
  onClose: () => void;
}

export function TemplateGallery({ onClose }: Props) {
  const { t } = useTranslation("templates");
  const [templates, setTemplates] = useState<ResponseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ResponseTemplate | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const { templates: list } = await listResponseTemplates();
      const sorted = (list || []).sort((a, b) => a.name.localeCompare(b.name));
      setTemplates(sorted);
      if (sorted.length > 0) setSelected(sorted[0]);
    } catch (e) {
      console.error("Failed to fetch templates:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resultTypes = [...new Set(templates.map(t => t.resultType))].sort();

  const filtered = filterType
    ? templates.filter(t => t.resultType === filterType)
    : templates;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2.5">
          <LayoutTemplate className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("gallery")}</h2>
          <span className="text-xs text-muted-foreground">
            {t("count", { count: templates.length })}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Type filter tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto">
        <Badge
          variant={filterType === null ? "default" : "outline"}
          className="cursor-pointer text-[10px] shrink-0"
          onClick={() => setFilterType(null)}
        >
          {t("filterAll", { count: templates.length })}
        </Badge>
        {resultTypes.map(type => {
          const count = templates.filter(t => t.resultType === type).length;
          return (
            <Badge
              key={type}
              variant={filterType === type ? "default" : "outline"}
              className="cursor-pointer text-[10px] shrink-0"
              onClick={() => setFilterType(filterType === type ? null : type)}
            >
              {type} ({count})
            </Badge>
          );
        })}
      </div>

      {/* Two-panel layout: list + preview */}
      <div className="flex flex-1 min-h-0">
        {/* Template list */}
        <div className="w-56 border-r overflow-y-auto shrink-0">
          {filtered.map(template => (
            <button
              key={template.id}
              onClick={() => setSelected(template)}
              className={`w-full text-left px-3 py-2.5 border-b transition-colors ${
                selected?.id === template.id
                  ? "bg-primary/8 border-l-2 border-l-primary"
                  : "hover:bg-accent/50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold font-mono truncate">{template.name}</span>
                <ChevronRight className={`w-3 h-3 shrink-0 ${
                  selected?.id === template.id ? "text-primary" : "text-muted-foreground/50"
                }`} />
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge variant="secondary" className="text-[9px] px-1 py-0">{template.resultType}</Badge>
                <span className="text-[9px] text-muted-foreground">
                  {t("fieldCount", { count: template.fields.length })}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Preview panel */}
        <div className="flex-1 overflow-y-auto p-5">
          {selected ? (
            <div className="space-y-4">
              {/* Template info */}
              <div>
                <h3 className="text-base font-semibold font-mono">{selected.name}</h3>
                {selected.description && (
                  <p className="text-xs text-muted-foreground mt-1">{selected.description}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="secondary">{selected.resultType}</Badge>
                </div>
              </div>

              {/* Card preview */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {t("cardPreview")}
                </p>
                <TemplateCardPreview template={selected} />
              </div>

              {/* Field schema */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {t("fieldsWithCount", { count: selected.fields.length })}
                </p>
                <div className="space-y-1">
                  {selected.fields.map(f => (
                    <div
                      key={f.key}
                      className="flex items-center justify-between px-3 py-1.5 rounded border text-xs"
                    >
                      <span className="font-mono font-medium">{f.key}</span>
                      <div className="flex items-center gap-2">
                        {f.label && <span className="text-muted-foreground">{f.label}</span>}
                        {f.icon && <span className="text-muted-foreground text-[10px]">{f.icon}</span>}
                        <Badge variant="outline" className="text-[10px]">{f.display}</Badge>
                        {f.color && <Badge variant="outline" className="text-[10px]">{f.color}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sample data */}
              {selected.sampleData && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {t("sampleData")}
                  </p>
                  <pre className="bg-muted rounded-lg p-3 text-[10px] font-mono overflow-x-auto leading-relaxed">
                    {JSON.stringify(selected.sampleData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {t("selectToPreview")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
