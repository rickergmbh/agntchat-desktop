import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import {
  useActiveWorkspace,
  useWorkspaces,
  useWorkspacesEnabled,
} from "../stores/workspaceStore";
import {
  type AgentLoop,
  listLoops,
  createLoop,
  updateLoop,
  deleteLoop,
  pauseLoop,
  resumeLoop,
  stopLoop,
} from "../lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Repeat,
  Plus,
  Pause,
  Play,
  Square,
  Trash2,
  Pencil,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";

const TERMINAL_STATUSES = new Set(["completed", "stopped", "exhausted", "failed"]);

const isTerminal = (loop: AgentLoop) => TERMINAL_STATUSES.has(loop.status);

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

function statusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "active":
      return "default";
    case "paused":
    case "blocked":
      return "secondary";
    case "failed":
    case "exhausted":
      return "destructive";
    default:
      return "outline";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-success";
    case "blocked":
      return "bg-warning";
    default:
      return "";
  }
}

// Map a save error to a display message: the loop-count limit gets its own
// copy; otherwise surface the server message, falling back to saveFailed.
function saveErrorMessage(e: unknown): string {
  const err = e as Error & { status?: number; code?: string };
  if (/limit/i.test(`${err?.code || ""} ${err?.message || ""}`)) {
    return i18n.t("agents:loops.errors.limitReached");
  }
  return e instanceof Error && e.message
    ? e.message
    : i18n.t("agents:loops.errors.saveFailed");
}

type TriggerMode = "continuous" | "interval";

interface LoopFormState {
  goal: string;
  directive: string;
  triggerMode: TriggerMode;
  intervalMinutes: string;
  maxIterations: string;
  // "__personal__" = owner's Personal workspace (no pin); otherwise a
  // workspace id. The shadcn Select can't hold an empty-string value, so
  // the sentinel stands in for "unpinned" in both create and edit.
  organizationId: string;
}

function defaultFormState(): LoopFormState {
  return {
    goal: "",
    directive: "",
    triggerMode: "continuous",
    intervalMinutes: "60",
    maxIterations: "50",
    organizationId: "__personal__",
  };
}

function LoopFormFields({
  state,
  setState,
}: {
  state: LoopFormState;
  setState: (next: LoopFormState) => void;
}) {
  const { t } = useTranslation("agents");
  const workspacesEnabled = useWorkspacesEnabled();
  const workspaces = useWorkspaces();

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">{t("loops.goal")}</Label>
        <Textarea
          className="min-h-[100px] text-sm leading-relaxed resize-y"
          value={state.goal}
          onChange={(e) => setState({ ...state, goal: e.target.value })}
          placeholder={t("loops.goalPlaceholder")}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("loops.directive")}</Label>
        <Textarea
          className="min-h-[80px] text-sm leading-relaxed resize-y"
          value={state.directive}
          onChange={(e) => setState({ ...state, directive: e.target.value })}
          placeholder={t("loops.directivePlaceholder")}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("loops.triggerMode")}</Label>
          <Select
            value={state.triggerMode}
            onValueChange={(v) =>
              setState({ ...state, triggerMode: (v as TriggerMode) ?? "continuous" })
            }
          >
            <SelectTrigger>
              <SelectValue>
                {(val: unknown) => t(`loops.mode.${String(val)}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="continuous">{t("loops.mode.continuous")}</SelectItem>
              <SelectItem value="interval">{t("loops.mode.interval")}</SelectItem>
            </SelectContent>
          </Select>
          {state.triggerMode === "continuous" && (
            <p className="text-[11px] text-muted-foreground">
              {t("loops.mode.continuousHint")}
            </p>
          )}
        </div>

        {state.triggerMode === "interval" && (
          <div className="space-y-1.5">
            <Label className="text-xs">{t("loops.intervalMinutes")}</Label>
            <Input
              type="number"
              min={5}
              max={1440}
              value={state.intervalMinutes}
              onChange={(e) =>
                setState({ ...state, intervalMinutes: e.target.value })
              }
            />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("loops.maxIterations")}</Label>
        <Input
          type="number"
          min={1}
          max={500}
          value={state.maxIterations}
          onChange={(e) => setState({ ...state, maxIterations: e.target.value })}
          className="w-32"
        />
      </div>

      {/* Workspace pin — only meaningful when the owner belongs to more
          than one workspace. "__personal__" is the Select-safe stand-in
          for "unpinned" (owner's Personal workspace). */}
      {workspacesEnabled && workspaces.length > 1 && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("workspacePin.label")}</Label>
          <Select
            value={state.organizationId || "__personal__"}
            onValueChange={(v) => {
              if (!v) return;
              setState({ ...state, organizationId: v });
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {(val: unknown) =>
                  String(val) === "__personal__"
                    ? t("pulse.defaultWorkspace")
                    : workspaces.find((w) => w.id === String(val))?.name ??
                      String(val ?? "")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__personal__">{t("pulse.defaultWorkspace")}</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {t("workspacePin.hint")}
          </p>
        </div>
      )}
    </>
  );
}

// Build the snake_case field payload shared by create and update.
function formToFields(state: LoopFormState): Record<string, unknown> {
  return {
    goal: state.goal.trim(),
    iteration_directive: state.directive.trim() || null,
    trigger_mode: state.triggerMode,
    ...(state.triggerMode === "interval"
      ? { interval_minutes: clamp(parseInt(state.intervalMinutes, 10) || 60, 5, 1440) }
      : {}),
    max_iterations: clamp(parseInt(state.maxIterations, 10) || 50, 1, 500),
  };
}

interface AgentLoopsProps {
  agentId: string;
}

export function AgentLoops({ agentId }: AgentLoopsProps) {
  const { t } = useTranslation("agents");
  const [loops, setLoops] = useState<AgentLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingLoop, setEditingLoop] = useState<AgentLoop | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    action: "stop" | "delete";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLoops = useCallback(async () => {
    try {
      setError(null);
      const { loops: data } = await listLoops(agentId);
      setLoops(data || []);
    } catch (e) {
      console.error("Failed to fetch loops:", e);
      setError(
        e instanceof Error ? e.message : i18n.t("agents:loops.errors.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchLoops();
  }, [fetchLoops]);

  const applyUpdated = (updated: AgentLoop) =>
    setLoops((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));

  const handlePauseResume = async (loop: AgentLoop) => {
    try {
      if (loop.status === "active") {
        const { loop: updated } = await pauseLoop(loop.id);
        applyUpdated(updated);
      } else {
        const { loop: updated } = await resumeLoop(loop.id);
        applyUpdated(updated);
      }
    } catch (e) {
      console.error("Failed to toggle loop:", e);
      window.alert(saveErrorMessage(e));
    }
  };

  const handleStop = async (id: string) => {
    try {
      const { loop: updated } = await stopLoop(id);
      applyUpdated(updated);
      setConfirmAction(null);
    } catch (e) {
      console.error("Failed to stop loop:", e);
      window.alert(saveErrorMessage(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLoop(id);
      setLoops((prev) => prev.filter((l) => l.id !== id));
      setConfirmAction(null);
    } catch (e) {
      console.error("Failed to delete loop:", e);
      window.alert(saveErrorMessage(e));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("common:loading")}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("loops.title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("loops.subtitle")}</p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("loops.create")}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {loops.length === 0 ? (
        <div className="text-center py-8 rounded-lg border bg-card">
          <Repeat className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-xs text-muted-foreground px-6">{t("loops.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {loops.map((loop) => {
            const terminal = isTerminal(loop);
            const confirming =
              confirmAction?.id === loop.id ? confirmAction.action : null;
            return (
              <div
                key={loop.id}
                className="p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{loop.goal}</span>
                      <Badge
                        variant={statusVariant(loop.status)}
                        className={`text-[10px] px-1.5 py-0 shrink-0 ${statusColor(loop.status)}`}
                      >
                        {t(`loops.status.${loop.status}`, {
                          defaultValue: loop.status,
                        })}
                      </Badge>
                      {loop.consecutiveFailures > 0 && !terminal && (
                        <Badge
                          variant="destructive"
                          className="text-[10px] px-1.5 py-0 shrink-0"
                        >
                          <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                          {loop.consecutiveFailures}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <p>
                        {t("loops.iterationsCount", {
                          current: loop.iterationCount,
                          max: loop.maxIterations,
                        })}
                      </p>
                      {loop.stopReason && (
                        <p>
                          {t(`loops.stopReason.${loop.stopReason}`, {
                            defaultValue: loop.stopReason,
                          })}
                        </p>
                      )}
                      {loop.lastProgressSummary && (
                        <p className="line-clamp-2">
                          <span className="font-medium">{t("loops.lastProgress")}: </span>
                          {loop.lastProgressSummary}
                        </p>
                      )}
                    </div>
                    {loop.status === "blocked" && loop.blockedQuestion && (
                      <div className="mt-2 flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 p-2 text-xs">
                        <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-warning" />
                        <div className="min-w-0">
                          <p className="font-medium">{t("loops.blockedQuestion")}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {loop.blockedQuestion}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-3 shrink-0">
                    {confirming ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {confirming === "stop"
                            ? t("loops.stopConfirm")
                            : t("loops.deleteConfirm")}
                        </span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() =>
                            confirming === "stop"
                              ? handleStop(loop.id)
                              : handleDelete(loop.id)
                          }
                        >
                          {t("common:confirm")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() => setConfirmAction(null)}
                        >
                          {t("common:cancel")}
                        </Button>
                      </div>
                    ) : terminal ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive/90"
                        onClick={() =>
                          setConfirmAction({ id: loop.id, action: "delete" })
                        }
                        title={t("common:delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handlePauseResume(loop)}
                          title={
                            loop.status === "active"
                              ? t("loops.pause")
                              : t("loops.resume")
                          }
                        >
                          {loop.status === "active" ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            setConfirmAction({ id: loop.id, action: "stop" })
                          }
                          title={t("loops.stop")}
                        >
                          <Square className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingLoop(loop)}
                          title={t("common:edit")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Loop Dialog */}
      <CreateLoopDialog
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          fetchLoops();
        }}
        agentId={agentId}
      />

      {/* Edit Loop Dialog */}
      <EditLoopDialog
        loop={editingLoop}
        onClose={() => {
          setEditingLoop(null);
          fetchLoops();
        }}
      />
    </div>
  );
}

// --- Create Loop Dialog ---

function CreateLoopDialog({
  open,
  onClose,
  agentId,
}: {
  open: boolean;
  onClose: () => void;
  agentId: string;
}) {
  const { t } = useTranslation("agents");
  const workspacesEnabled = useWorkspacesEnabled();
  const activeWorkspace = useActiveWorkspace();
  // Pre-select the workspace the user is currently in (a real workspace,
  // not Personal); otherwise leave unpinned.
  const initialOrgId =
    workspacesEnabled && activeWorkspace ? activeWorkspace.id : "__personal__";
  const [form, setForm] = useState<LoopFormState>(() => ({
    ...defaultFormState(),
    organizationId: initialOrgId,
  }));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setForm({ ...defaultFormState(), organizationId: initialOrgId });
    setError(null);
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const fields = formToFields(form);
      await createLoop({
        agent_id: agentId,
        goal: fields.goal as string,
        trigger_mode: form.triggerMode,
        ...(fields.iteration_directive
          ? { iteration_directive: fields.iteration_directive as string }
          : {}),
        ...(form.triggerMode === "interval"
          ? { interval_minutes: fields.interval_minutes as number }
          : {}),
        max_iterations: fields.max_iterations as number,
        ...(form.organizationId !== "__personal__"
          ? { organization_id: form.organizationId }
          : {}),
      });
      resetForm();
      onClose();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[90vw] sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>{t("loops.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <LoopFormFields state={form} setState={setForm} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t shrink-0 flex gap-2 justify-end">
          <Button variant="outline" onClick={handleClose}>
            {t("common:cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={creating || !form.goal.trim()}>
            {creating ? t("common:creating") : t("loops.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit Loop Dialog ---

function EditLoopDialog({
  loop,
  onClose,
}: {
  loop: AgentLoop | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("agents");
  const [form, setForm] = useState<LoopFormState>(() => defaultFormState());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loop) {
      setForm({
        goal: loop.goal,
        directive: loop.iterationDirective || "",
        triggerMode: loop.triggerMode,
        intervalMinutes: String(loop.intervalMinutes ?? 60),
        maxIterations: String(loop.maxIterations),
        organizationId: loop.organizationId ?? "__personal__",
      });
      setError(null);
    }
  }, [loop]);

  const handleSave = async () => {
    if (!loop) return;
    setSaving(true);
    setError(null);
    try {
      await updateLoop(loop.id, {
        ...formToFields(form),
        // Always send on PATCH: "" clears the pin, a workspace id sets it.
        organization_id:
          form.organizationId === "__personal__" ? "" : form.organizationId,
      });
      onClose();
    } catch (e) {
      setError(saveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!loop} onOpenChange={() => onClose()}>
      <DialogContent className="w-[90vw] sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>{t("loops.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <LoopFormFields state={form} setState={setForm} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t shrink-0 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common:cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || !form.goal.trim()}>
            {saving ? t("common:saving") : t("common:saveChanges")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
