import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  type Memory,
  type FamilyMemory,
  type MemoryCategory,
  type MemoryInput,
  getAgentMemories,
  createAgentMemory,
  updateAgentMemory,
  deleteAgentMemory,
  getFamilyMemories,
  saveFamilyMemory,
  deleteFamilyMemory,
} from "../lib/api";
import {
  useActiveWorkspace,
  useWorkspaces,
  useWorkspacesEnabled,
} from "../stores/workspaceStore";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain,
  Users,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";

interface AgentMemoryProps {
  agentId: string;
  agentName?: string;
}

const CATEGORIES: MemoryCategory[] = [
  "fact",
  "preference",
  "learning",
  "relationship",
  "skill",
];

// labelKey pattern — resolved with t() at render time, never at module scope.
//
// Two maps, because one label can't serve both spots: plural reads as a
// section name (group headers, "already exists in Preferences") while a
// dropdown option names a single category. They were previously one map
// pointing at `categories.*`, which does not exist in the memory namespace —
// so every one of these rendered as the raw key string.
const CATEGORY_LABEL_KEYS: Record<MemoryCategory, string> = {
  fact: "categoryPlural.fact",
  preference: "categoryPlural.preference",
  learning: "categoryPlural.learning",
  relationship: "categoryPlural.relationship",
  skill: "categoryPlural.skill",
};

const CATEGORY_SINGULAR_KEYS: Record<MemoryCategory, string> = {
  fact: "categorySingular.fact",
  preference: "categorySingular.preference",
  learning: "categorySingular.learning",
  relationship: "categorySingular.relationship",
  skill: "categorySingular.skill",
};

// A row is either an agent Memory or a FamilyMemory — both share the fields the
// list and form care about, so the UI treats them uniformly and the scope flag
// drives where writes go.
type AnyMemory = Memory | FamilyMemory;

// Sentinel for "family-global" in the workspace-scope selector — a family
// memory with no organizationId is visible in every workspace. Distinct from
// the loops' "__personal__" sentinel: family-wide means ALL workspaces.
const FAMILY_WIDE_SCOPE = "__family__";

export function AgentMemory({ agentId, agentName }: AgentMemoryProps) {
  const { t } = useTranslation("memory");

  // Workspace context for the two-tier family scope badge. Hidden while
  // workspaces are off or there's only one — every row would carry the same
  // badge.
  const workspaces = useWorkspaces();
  const workspacesEnabled = useWorkspacesEnabled();
  const activeWorkspace = useActiveWorkspace();
  const scopeSelectable = workspacesEnabled && workspaces.length > 1;
  const familyScopeLabel = useCallback(
    (m: AnyMemory): string | null => {
      if (!scopeSelectable) return null;
      const orgId = "organizationId" in m ? m.organizationId : null;
      if (!orgId) return t("scope.familyWide");
      return (
        workspaces.find((w) => w.id === orgId)?.name ?? t("scope.otherWorkspace")
      );
    },
    [scopeSelectable, workspaces, t]
  );

  const [agentMemories, setAgentMemories] = useState<Memory[]>([]);
  const [familyMemories, setFamilyMemories] = useState<FamilyMemory[]>([]);
  const [agentPage, setAgentPage] = useState({ total: 0, hasMore: false });
  const [familyPage, setFamilyPage] = useState({ total: 0, hasMore: false });
  const [loadingMore, setLoadingMore] = useState<"agent" | "family" | null>(null);

  // Workspace isolation: the manager shows the active workspace's view —
  // family-global rows plus rows scoped to the workspace you're standing in
  // (the same read rule agents get). Another workspace's memories are managed
  // by switching to that workspace; they never surface here.
  //
  // The scope is applied SERVER-side. Filtering the page client-side instead
  // would break paging: an offset page could consist entirely of another
  // workspace's rows and render as empty, and the total would count rows this
  // view can never show.
  const familyScope =
    workspacesEnabled && activeWorkspace ? activeWorkspace.id : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state — a single create/edit dialog parameterized by scope + the
  // row being edited (null = create).
  const [dialogScope, setDialogScope] = useState<"agent" | "family" | null>(
    null
  );
  const [editing, setEditing] = useState<AnyMemory | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agent, family] = await Promise.all([
        getAgentMemories(agentId),
        getFamilyMemories({ organizationId: familyScope }),
      ]);
      setAgentMemories(agent.memories || []);
      setFamilyMemories(family.memories || []);
      setAgentPage({
        total: agent.total ?? agent.memories?.length ?? 0,
        hasMore: agent.hasMore ?? false,
      });
      setFamilyPage({
        total: family.total ?? family.memories?.length ?? 0,
        hasMore: family.hasMore ?? false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [agentId, familyScope]);

  // Both lists are ordered `updated_at DESC`, so an edit bumps a row to the
  // front and shifts everything after it. Dedupe by id or the next offset page
  // would re-deliver a row already on screen.
  const appendUnique = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
    const seen = new Set(existing.map((m) => m.id));
    return [...existing, ...incoming.filter((m) => !seen.has(m.id))];
  };

  const loadMoreAgent = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore("agent");
    setError(null);
    try {
      const page = await getAgentMemories(agentId, { offset: agentMemories.length });
      const merged = appendUnique(agentMemories, page.memories || []);
      setAgentMemories(merged);
      setAgentPage({
        total: page.total ?? merged.length,
        // Trust the server's flag, but stop if a page added nothing — a
        // shifting window must not leave the button live with no way forward.
        hasMore: (page.hasMore ?? false) && merged.length > agentMemories.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.loadFailed"));
    } finally {
      setLoadingMore(null);
    }
  }, [agentId, agentMemories, loadingMore, t]);

  const loadMoreFamily = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore("family");
    setError(null);
    try {
      const page = await getFamilyMemories({
        offset: familyMemories.length,
        organizationId: familyScope,
      });
      const merged = appendUnique(familyMemories, page.memories || []);
      setFamilyMemories(merged);
      setFamilyPage({
        total: page.total ?? merged.length,
        hasMore: (page.hasMore ?? false) && merged.length > familyMemories.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.loadFamilyFailed"));
    } finally {
      setLoadingMore(null);
    }
  }, [familyMemories, familyScope, loadingMore, t]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const closeDialog = () => {
    setDialogScope(null);
    setEditing(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Two distinct memory scopes, split into tabs so neither is missed.
          Agent memories lead since they're the per-agent ones being edited. */}
      <Tabs defaultValue="agent" className="w-full">
        <TabsList>
          <TabsTrigger value="agent" className="gap-1.5">
            <Brain className="w-3.5 h-3.5" />
            {t("agentMemories")}
            {agentMemories.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ({agentMemories.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="family" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />
            {t("familyMemories")}
            {familyMemories.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ({familyMemories.length})
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Agent memories — what THIS agent remembers */}
        <TabsContent value="agent" className="mt-4">
          <MemorySection
            icon={<Brain className="w-4 h-4 text-primary" />}
            title={t("agentMemories")}
            subtitle={t("agentSubtitle", { name: agentName || t("agents:thisAgent") })}
            memories={agentMemories}
            total={agentPage.total}
            hasMore={agentPage.hasMore}
            loadingMore={loadingMore === "agent"}
            onLoadMore={loadMoreAgent}
            emptyHint={t("emptyAgentHint")}
            onAdd={() => {
              setEditing(null);
              setDialogScope("agent");
            }}
            onEdit={(m) => {
              setEditing(m);
              setDialogScope("agent");
            }}
            onDeleted={fetchAll}
            onDelete={(m) => deleteAgentMemory(agentId, m.id)}
          />
        </TabsContent>

        {/* Family memories — shared across ALL the user's agents */}
        <TabsContent value="family" className="mt-4">
          <MemorySection
            icon={<Users className="w-4 h-4 text-primary" />}
            title={t("familyMemories")}
            subtitle={t("familyNotice")}
            shared
            scopeLabel={familyScopeLabel}
            memories={familyMemories}
            total={familyPage.total}
            hasMore={familyPage.hasMore}
            loadingMore={loadingMore === "family"}
            onLoadMore={loadMoreFamily}
            emptyHint={t("emptyFamilyHint")}
            onAdd={() => {
              setEditing(null);
              setDialogScope("family");
            }}
            onEdit={(m) => {
              setEditing(m);
              setDialogScope("family");
            }}
            onDeleted={fetchAll}
            onDelete={(m) => deleteFamilyMemory(m.id).then(() => undefined)}
          />
        </TabsContent>
      </Tabs>

      {dialogScope && (
        <MemoryFormDialog
          open
          scope={dialogScope}
          agentId={agentId}
          existing={editing}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

// --- Memory Section (one group: agent or family) ---

function MemorySection({
  icon,
  title,
  subtitle,
  shared = false,
  scopeLabel,
  memories,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyHint,
  onAdd,
  onEdit,
  onDelete,
  onDeleted,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  shared?: boolean;
  // Family list only: resolves a row to its workspace badge text.
  scopeLabel?: (m: AnyMemory) => string | null;
  memories: AnyMemory[];
  // Full size of the set behind `memories`, which is only the pages loaded so
  // far. Before pagination this list silently stopped at the server's default
  // of 50, stranding every older memory beyond review or deletion.
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  emptyHint: string;
  onAdd: () => void;
  onEdit: (m: AnyMemory) => void;
  onDelete: (m: AnyMemory) => Promise<unknown>;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("memory");
  // Group by category, preserving the canonical category order.
  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    items: memories.filter((m) => m.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-sm font-semibold">{title}</h3>
            {shared && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {t("sharedBadge")}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          {shared && (
            <p className="text-[11px] text-warning mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {t("familyEditWarning")}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("common:add")}
        </Button>
      </div>

      {memories.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">{emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byCategory.map((group) => (
            <div key={group.cat}>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                {t(CATEGORY_LABEL_KEYS[group.cat])}
              </div>
              <div className="space-y-1.5">
                {group.items.map((m) => (
                  <MemoryRow
                    key={m.id}
                    memory={m}
                    shared={shared}
                    scopeBadge={scopeLabel ? scopeLabel(m) : null}
                    onEdit={() => onEdit(m)}
                    onDelete={onDelete}
                    onDeleted={onDeleted}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(hasMore || memories.length < total) && (
        <div className="flex flex-col items-center gap-2 pt-3">
          <p className="text-xs text-muted-foreground">
            {t("showingCount", { shown: memories.length, total })}
          </p>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? t("loading") : t("loadMore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Memory Row ---

function MemoryRow({
  memory,
  shared,
  scopeBadge,
  onEdit,
  onDelete,
  onDeleted,
}: {
  memory: AnyMemory;
  shared: boolean;
  // Family rows: workspace name the row is scoped to, or the family-wide label.
  scopeBadge?: string | null;
  onEdit: () => void;
  onDelete: (m: AnyMemory) => Promise<unknown>;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("memory");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete(memory);
      setConfirming(false);
      onDeleted();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : shared
            ? t("deleteFamilyFailed")
            : t("common:errors.deleteFailed")
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold break-all">{memory.key}</span>
            {typeof memory.confidence === "number" && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {Math.round(memory.confidence * 100)}%
              </Badge>
            )}
            {scopeBadge && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {scopeBadge}
              </Badge>
            )}
          </div>
          <p className="text-sm text-foreground/90 mt-0.5 whitespace-pre-wrap break-words">
            {memory.content}
          </p>
          {memory.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {memory.description}
            </p>
          )}
          {memory.tags?.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1.5">
              {memory.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive/90"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="flex items-center gap-2 mt-2 p-2 rounded-lg border border-destructive/30 bg-destructive/5">
          <p className="text-xs text-destructive flex-1">
            {shared
              ? t("deleteFamilyConfirm", { key: memory.key })
              : t("common:confirmDelete", { name: memory.key })}
          </p>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? t("common:deleting") : t("common:delete")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            {t("common:cancel")}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

// --- Create / Edit Dialog ---

function MemoryFormDialog({
  open,
  scope,
  agentId,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  scope: "agent" | "family";
  agentId: string;
  existing: AnyMemory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("memory");
  const isEdit = !!existing;

  // Two-tier family scope. Selectable on create, locked on edit — the scope
  // is part of the row's identity (the upsert key is scope + category + key).
  // New memories default to the workspace you're standing in (when it's a
  // real, non-Personal one) — mirroring the loops/routines pickers.
  const workspaces = useWorkspaces();
  const workspacesEnabled = useWorkspacesEnabled();
  const activeWorkspace = useActiveWorkspace();
  const scopeSelectable = workspacesEnabled && workspaces.length > 1;
  const [organizationId, setOrganizationId] = useState<string>(() => {
    if (existing) {
      return (
        ("organizationId" in existing && existing.organizationId) ||
        FAMILY_WIDE_SCOPE
      );
    }
    return scopeSelectable && activeWorkspace && !activeWorkspace.isPersonal
      ? activeWorkspace.id
      : FAMILY_WIDE_SCOPE;
  });

  const [category, setCategory] = useState<MemoryCategory>(
    existing?.category ?? "fact"
  );
  const [key, setKey] = useState(existing?.key ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [confidence, setConfidence] = useState(
    existing && typeof existing.confidence === "number"
      ? String(existing.confidence)
      : "0.7"
  );
  const [tags, setTags] = useState(existing?.tags?.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const trimmedKey = key.trim();
    const conf = confidence.trim() === "" ? undefined : Number(confidence);
    if (conf !== undefined && (Number.isNaN(conf) || conf < 0 || conf > 1)) {
      setError(t("form.confidenceRange"));
      setSaving(false);
      return;
    }
    const tagsList = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    try {
      if (scope === "agent") {
        if (isEdit && existing) {
          // Agent memories have a real PATCH; key/category stay fixed.
          await updateAgentMemory(agentId, existing.id, {
            content,
            confidence: conf,
            description: description.trim() || undefined,
            tags: tagsList,
          });
        } else {
          const body: MemoryInput = {
            category,
            key: trimmedKey,
            content,
            confidence: conf,
            description: description.trim() || undefined,
            tags: tagsList,
          };
          try {
            await createAgentMemory(agentId, body);
          } catch (e) {
            if (isConflict(e)) {
              setError(
                t("alreadyExistsMessage", {
                  key: trimmedKey,
                  category: t(CATEGORY_LABEL_KEYS[category]),
                })
              );
              setSaving(false);
              return;
            }
            throw e;
          }
        }
      } else {
        // Family memories have no PATCH — an edit is a forced POST of the same
        // category + key. A brand-new collision surfaces a friendly message.
        // The scope is part of the upsert key, so always send it — an edit
        // that omitted it would land in the human default (family-global)
        // instead of the row's own workspace.
        const body: MemoryInput = {
          category,
          key: trimmedKey,
          content,
          confidence: conf,
          description: description.trim() || undefined,
          tags: tagsList,
          force: isEdit ? true : undefined,
          ...(organizationId === FAMILY_WIDE_SCOPE
            ? { scope: "family" as const }
            : { organizationId }),
        };
        try {
          await saveFamilyMemory(body);
        } catch (e) {
          if (isConflict(e)) {
            setError(
              t("familyAlreadyExistsMessage", {
                key: trimmedKey,
                category: t(CATEGORY_LABEL_KEYS[category]),
              })
            );
            setSaving(false);
            return;
          }
          throw e;
        }
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle =
    scope === "family"
      ? isEdit
        ? t("form.titleEditFamily")
        : t("form.titleNewFamily")
      : isEdit
        ? t("form.titleEdit")
        : t("form.titleNew");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        {scope === "family" && (
          <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {t("form.sharedNotice")}
          </div>
        )}

        <div className="space-y-4">
          {/* Two-tier scope — family-wide or pinned to one workspace. Only
              shown with >1 workspace; locked on edit since the scope is part
              of the row's identity. */}
          {scope === "family" && scopeSelectable && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("scope.label")}</Label>
              <Select
                value={organizationId}
                onValueChange={(v) => v && setOrganizationId(v)}
                disabled={isEdit}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(val: unknown) =>
                      String(val) === FAMILY_WIDE_SCOPE
                        ? t("scope.familyOption")
                        : workspaces.find((w) => w.id === String(val))?.name ??
                          t("scope.otherWorkspace")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FAMILY_WIDE_SCOPE}>
                    {t("scope.familyOption")}
                  </SelectItem>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {isEdit ? t("scope.fixed") : t("scope.hint")}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("form.category")}</Label>
              <Select
                value={category}
                onValueChange={(v) => v && setCategory(v as MemoryCategory)}
                disabled={isEdit}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(val: unknown) =>
                      t(CATEGORY_SINGULAR_KEYS[val as MemoryCategory] ?? String(val))
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(CATEGORY_SINGULAR_KEYS[c])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("form.key")}</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t("form.keyPlaceholder")}
                className="font-mono text-xs"
                disabled={isEdit}
              />
            </div>
          </div>
          {isEdit && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              {t("form.keyFixed")}
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">{t("form.content")}</Label>
            <Textarea
              className="min-h-[100px] text-sm leading-relaxed resize-y"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("form.contentPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("common:descriptionOptional")}</Label>
            <Input
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("form.descriptionPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("form.confidenceLabel")}</Label>
              <Input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
                placeholder="0.7"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("form.tags")}</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t("form.tagsPlaceholder")}
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={saving || !content.trim() || (!isEdit && !key.trim())}
              className="flex-1"
            >
              {saving
                ? t("common:saving")
                : isEdit
                  ? t("common:saveChanges")
                  : t("common:add")}
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1">
              {t("common:cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Helpers ---

function isConflict(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 409
  );
}
