import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  type ResponseTemplate,
  type DetailField,
  listResponseTemplates,
  updateAgent,
} from "../lib/api";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
import { TemplateCardPreview } from "./TemplateCardPreview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LayoutTemplate,
  Plus,
  Trash2,
  Eye,
} from "lucide-react";

interface AgentTemplatesProps {
  managed: ManagedAgent;
}

export function AgentTemplates({ managed }: AgentTemplatesProps) {
  const { t } = useTranslation("templates");
  const { fetchAgents } = useAgentStore();
  const [allTemplates, setAllTemplates] = useState<ResponseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewTemplate, setViewTemplate] = useState<ResponseTemplate | null>(
    null
  );

  const { agent } = managed;
  const detailTemplates =
    agent.structuredCapabilities?.detail_templates || {};
  const assignedNames = new Set(Object.keys(detailTemplates));

  const fetchTemplates = useCallback(async () => {
    try {
      const { templates } = await listResponseTemplates();
      setAllTemplates(templates || []);
    } catch (e) {
      console.error("Failed to fetch templates:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const unassigned = allTemplates.filter((t) => !assignedNames.has(t.name));

  const handleAdd = async (template: ResponseTemplate) => {
    const sc = agent.structuredCapabilities || {};
    const dt = { ...(sc.detail_templates || {}), [template.name]: template.fields };
    try {
      await updateAgent(agent.id, {
        structuredCapabilities: { ...sc, detail_templates: dt },
      });
      await fetchAgents();
      setShowAdd(false);
    } catch (e) {
      console.error("Failed to add template:", e);
    }
  };

  const handleRemove = async (name: string) => {
    const sc = agent.structuredCapabilities || {};
    const dt = { ...(sc.detail_templates || {}) };
    delete dt[name];
    try {
      await updateAgent(agent.id, {
        structuredCapabilities: { ...sc, detail_templates: dt },
      });
      await fetchAgents();
    } catch (e) {
      console.error("Failed to remove template:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  const assignedEntries = Object.entries(detailTemplates);

  return (
    <div className="p-5 space-y-6">
      {assignedEntries.length === 0 ? (
        <div className="text-center py-8">
          <LayoutTemplate className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">{t("emptyLabel")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("emptyDescription")}
          </p>
          <Button
            size="sm"
            className="mt-4"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("add")}
          </Button>
        </div>
      ) : (
        <>
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t("assigned")}
            </span>
            <div className="space-y-1 mt-2">
              {assignedEntries.map(([name, fields]) => {
                const source = allTemplates.find((t) => t.name === name);
                return (
                  <div
                    key={name}
                    className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => {
                        if (source) setViewTemplate(source);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate font-mono">
                          {name}
                        </span>
                        {source?.resultType && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            {source.resultType}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {source?.description ||
                          t("fieldCount", { count: (fields as DetailField[]).length })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {source && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setViewTemplate(source)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive/90"
                        onClick={() => handleRemove(name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("add")}
          </Button>
        </>
      )}

      {/* View Template Dialog — rendered card preview only */}
      <Dialog
        open={!!viewTemplate}
        onOpenChange={() => setViewTemplate(null)}
      >
        <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{viewTemplate?.name}</DialogTitle>
            {viewTemplate?.description && (
              <p className="text-xs text-muted-foreground">
                {viewTemplate.description}
              </p>
            )}
          </DialogHeader>
          {viewTemplate && (
            <div className="flex justify-center rounded-xl border border-border bg-muted/20 p-4">
              <TemplateCardPreview template={viewTemplate} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Template Dialog */}
      <AddTemplateDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        templates={unassigned}
        onAdd={handleAdd}
      />
    </div>
  );
}

function AddTemplateDialog({
  open,
  onClose,
  templates,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  templates: ResponseTemplate[];
  onAdd: (t: ResponseTemplate) => void;
}) {
  const { t } = useTranslation("templates");
  const [search, setSearch] = useState("");

  const filtered = templates.filter(
    (tpl) =>
      tpl.name.includes(search.toLowerCase()) ||
      (tpl.description || "").toLowerCase().includes(search.toLowerCase()) ||
      tpl.resultType.includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("add")}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3"
        />
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {templates.length === 0 ? t("allAssigned") : t("noMatches")}
          </p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {filtered.map((tpl) => (
              <div
                key={tpl.id}
                className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate font-mono">
                      {tpl.name}
                    </p>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {tpl.resultType}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {tpl.description || t("fieldCount", { count: tpl.fields.length })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onAdd(tpl)}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
