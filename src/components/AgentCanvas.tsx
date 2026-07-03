import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  type CanvasDefinitionSummary,
  listCanvasDefinitions,
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
  Palette,
  Check,
  ExternalLink,
  Trash2,
} from "lucide-react";

interface AgentCanvasProps {
  managed: ManagedAgent;
}

function getApiUrl(): string {
  return localStorage.getItem("apiUrl") || "https://agentchat-backend.fly.dev";
}

export function AgentCanvas({ managed }: AgentCanvasProps) {
  const { t } = useTranslation("canvas");
  const { fetchAgents } = useAgentStore();
  const [definitions, setDefinitions] = useState<CanvasDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  const { agent } = managed;
  const ep = agent.structuredCapabilities?.experience_profile as
    | Record<string, unknown>
    | undefined;
  const canvasConfig = ep?.canvas as Record<string, unknown> | undefined;
  const currentDefinitionId = canvasConfig?.definition_id as string | undefined;

  const fetchDefinitions = useCallback(async () => {
    try {
      const { definitions: defs } = await listCanvasDefinitions();
      setDefinitions(defs || []);
    } catch (e) {
      console.error("Failed to fetch canvas definitions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  const currentCanvas = currentDefinitionId
    ? definitions.find((d) => d.id === currentDefinitionId)
    : null;

  const handleAssign = async (def: CanvasDefinitionSummary) => {
    const sc = agent.structuredCapabilities || {};
    const ep = (sc.experience_profile as Record<string, unknown>) || {};
    const canvas = (ep.canvas as Record<string, unknown>) || {};

    try {
      await updateAgent(agent.id, {
        structuredCapabilities: {
          ...sc,
          experience_profile: {
            ...ep,
            version: 1,
            canvas: { ...canvas, definition_id: def.id },
          },
        },
      });
      await fetchAgents();
      setShowPicker(false);
    } catch (e) {
      console.error("Failed to assign canvas:", e);
    }
  };

  const handleRemove = async () => {
    const sc = agent.structuredCapabilities || {};
    const ep = (sc.experience_profile as Record<string, unknown>) || {};
    const canvas = (ep.canvas as Record<string, unknown>) || {};
    const { definition_id: _, ...canvasWithout } = canvas;

    try {
      await updateAgent(agent.id, {
        structuredCapabilities: {
          ...sc,
          experience_profile: {
            ...ep,
            canvas: Object.keys(canvasWithout).length > 0 ? canvasWithout : undefined,
          },
        },
      });
      await fetchAgents();
    } catch (e) {
      console.error("Failed to remove canvas:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      {/* Current canvas */}
      <div>
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          {t("active")}
        </span>
        {currentCanvas ? (
          <div className="mt-2 p-3 rounded-lg border bg-card">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{currentCanvas.name}</span>
                  {currentCanvas.isBuiltin && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {t("status.builtin")}
                    </Badge>
                  )}
                  {currentCanvas.isPublished && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t("status.published")}
                    </Badge>
                  )}
                </div>
                {currentCanvas.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {currentCanvas.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive/90"
                  onClick={handleRemove}
                  title={t("remove")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 font-mono">
              {t("idLabel", { id: currentCanvas.id })}
            </p>
          </div>
        ) : currentDefinitionId ? (
          <div className="mt-2 p-3 rounded-lg border bg-card">
            <p className="text-sm text-muted-foreground">
              {t("assignedNotFound")}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
              {t("idLabel", { id: currentDefinitionId })}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={handleRemove}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t("common:remove")}
            </Button>
          </div>
        ) : (
          <div className="mt-2 text-center py-6">
            <Palette className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">{t("none")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("noneDescription")}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowPicker(true)}>
          <Palette className="w-3.5 h-3.5 mr-1.5" />
          {currentDefinitionId ? t("change") : t("assign")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            window.open(`${getApiUrl()}/dashboard`, "_blank");
          }}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          {t("studio")}
        </Button>
      </div>

      {/* Available canvases list */}
      <div>
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          {t("availableWithCount", { count: definitions.length })}
        </span>
        <div className="space-y-1 mt-2">
          {definitions.map((def) => {
            const isActive = def.id === currentDefinitionId;
            return (
              <div
                key={def.id}
                className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                  isActive
                    ? "border-primary/30 bg-primary/5"
                    : "bg-card hover:bg-accent/50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {def.name}
                    </span>
                    {def.isBuiltin && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {t("status.builtin")}
                      </Badge>
                    )}
                    {!def.isPublished && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t("status.draft")}
                      </Badge>
                    )}
                    {isActive && (
                      <Check className="w-3.5 h-3.5 text-primary" />
                    )}
                  </div>
                  {def.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {def.description}
                    </p>
                  )}
                </div>
                {!isActive && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleAssign(def)}
                  >
                    {t("common:apply")}
                  </Button>
                )}
              </div>
            );
          })}
          {definitions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("emptyList")}
            </p>
          )}
        </div>
      </div>

      {/* Picker dialog */}
      <CanvasPickerDialog
        open={showPicker}
        onClose={() => setShowPicker(false)}
        definitions={definitions}
        currentId={currentDefinitionId}
        onSelect={handleAssign}
      />
    </div>
  );
}

function CanvasPickerDialog({
  open,
  onClose,
  definitions,
  currentId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  definitions: CanvasDefinitionSummary[];
  currentId?: string;
  onSelect: (d: CanvasDefinitionSummary) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = definitions.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.description || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select Canvas</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search canvases..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3"
        />
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No matching canvases.
          </p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {filtered.map((def) => {
              const isActive = def.id === currentId;
              return (
                <div
                  key={def.id}
                  className={`flex items-center justify-between p-2.5 rounded-lg border ${
                    isActive ? "border-primary/30 bg-primary/5" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{def.name}</p>
                      {def.isBuiltin && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          builtin
                        </Badge>
                      )}
                      {isActive && <Check className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {def.description || `v${def.version}`}
                    </p>
                  </div>
                  {!isActive && (
                    <Button size="sm" variant="ghost" onClick={() => onSelect(def)}>
                      Apply
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
