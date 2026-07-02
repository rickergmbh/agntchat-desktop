import { useEffect, useState, useCallback } from "react";
import {
  type ResponseTemplate,
  type DetailField,
  listResponseTemplates,
  updateAgent,
} from "../lib/api";
import { useAgentStore, type ManagedAgent } from "../stores/agentStore";
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
        Loading templates...
      </div>
    );
  }

  const assignedEntries = Object.entries(detailTemplates);

  return (
    <div className="p-5 space-y-6">
      {assignedEntries.length === 0 ? (
        <div className="text-center py-8">
          <LayoutTemplate className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">No response templates</p>
          <p className="text-xs text-muted-foreground mt-1">
            Templates define how this agent formats structured results (hotels,
            emails, products, etc.)
          </p>
          <Button
            size="sm"
            className="mt-4"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Template
          </Button>
        </div>
      ) : (
        <>
          <div>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Assigned Templates
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
                          `${(fields as DetailField[]).length} field(s)`}
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
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Template
          </Button>
        </>
      )}

      {/* View Template Dialog */}
      <Dialog
        open={!!viewTemplate}
        onOpenChange={() => setViewTemplate(null)}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewTemplate?.name}</DialogTitle>
          </DialogHeader>
          {viewTemplate && (
            <div className="space-y-3">
              {viewTemplate.description && (
                <p className="text-sm text-muted-foreground">
                  {viewTemplate.description}
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                <Badge variant="secondary">{viewTemplate.resultType}</Badge>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Fields ({viewTemplate.fields.length})
                </p>
                <div className="space-y-1">
                  {viewTemplate.fields.map((f) => (
                    <div
                      key={f.key}
                      className="flex items-center justify-between px-3 py-1.5 rounded border text-xs"
                    >
                      <span className="font-mono font-medium">{f.key}</span>
                      <div className="flex items-center gap-2">
                        {f.label && (
                          <span className="text-muted-foreground">
                            {f.label}
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {f.display}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {viewTemplate.sampleData && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Sample Data
                  </p>
                  <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto">
                    {JSON.stringify(viewTemplate.sampleData, null, 2)}
                  </pre>
                </div>
              )}
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
  const [search, setSearch] = useState("");

  const filtered = templates.filter(
    (t) =>
      t.name.includes(search.toLowerCase()) ||
      (t.description || "").toLowerCase().includes(search.toLowerCase()) ||
      t.resultType.includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Template</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3"
        />
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {templates.length === 0
              ? "All available templates are already assigned."
              : "No matching templates."}
          </p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {filtered.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-2.5 rounded-lg border hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate font-mono">
                      {t.name}
                    </p>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {t.resultType}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {t.description || `${t.fields.length} field(s)`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onAdd(t)}
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
