import { useEffect, useState, useCallback } from "react";
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

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  fact: "Facts",
  preference: "Preferences",
  learning: "Learnings",
  relationship: "Relationships",
  skill: "Skills",
};

// A row is either an agent Memory or a FamilyMemory — both share the fields the
// list and form care about, so the UI treats them uniformly and the scope flag
// drives where writes go.
type AnyMemory = Memory | FamilyMemory;

export function AgentMemory({ agentId, agentName }: AgentMemoryProps) {
  const [agentMemories, setAgentMemories] = useState<Memory[]>([]);
  const [familyMemories, setFamilyMemories] = useState<FamilyMemory[]>([]);
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
        getFamilyMemories(),
      ]);
      setAgentMemories(agent.memories || []);
      setFamilyMemories(family.memories || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

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
        Loading memories...
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
            Agent Memories
            {agentMemories.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                ({agentMemories.length})
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="family" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />
            Family Memories
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
            title="Agent Memories"
            subtitle={
              agentName
                ? `What ${agentName} remembers — specific to this agent.`
                : "What this agent remembers — specific to this agent."
            }
            memories={agentMemories}
            emptyHint="This agent hasn't remembered anything yet. Add a fact, preference, or learning it should keep in mind."
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
            title="Family Memories"
            subtitle="Shared across all of your agents."
            shared
            memories={familyMemories}
            emptyHint="No shared memories yet. Anything you add here is visible to every agent in your family."
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
  memories,
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
  memories: AnyMemory[];
  emptyHint: string;
  onAdd: () => void;
  onEdit: (m: AnyMemory) => void;
  onDelete: (m: AnyMemory) => Promise<unknown>;
  onDeleted: () => void;
}) {
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
                Shared
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          {shared && (
            <p className="text-[11px] text-warning mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Editing or deleting a family memory affects every agent you own.
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add
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
                {CATEGORY_LABELS[group.cat]}
              </div>
              <div className="space-y-1.5">
                {group.items.map((m) => (
                  <MemoryRow
                    key={m.id}
                    memory={m}
                    shared={shared}
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
    </div>
  );
}

// --- Memory Row ---

function MemoryRow({
  memory,
  shared,
  onEdit,
  onDelete,
  onDeleted,
}: {
  memory: AnyMemory;
  shared: boolean;
  onEdit: () => void;
  onDelete: (m: AnyMemory) => Promise<unknown>;
  onDeleted: () => void;
}) {
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
      setError(e instanceof Error ? e.message : "Failed to delete");
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
              {memory.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">
                  {t}
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
              ? "Delete this family memory for ALL your agents?"
              : "Delete this memory? This cannot be undone."}
          </p>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            Cancel
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
  const isEdit = !!existing;
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
      setError("Confidence must be a number between 0 and 1.");
      setSaving(false);
      return;
    }
    const tagsList = tags
      .split(",")
      .map((t) => t.trim())
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
                "A memory with this category and key already exists. Pick a different key, or edit the existing one."
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
        const body: MemoryInput = {
          category,
          key: trimmedKey,
          content,
          confidence: conf,
          description: description.trim() || undefined,
          tags: tagsList,
          force: isEdit ? true : undefined,
        };
        try {
          await saveFamilyMemory(body);
        } catch (e) {
          if (isConflict(e)) {
            setError(
              "A family memory with this category and key already exists. Pick a different key, or edit the existing one."
            );
            setSaving(false);
            return;
          }
          throw e;
        }
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save memory");
    } finally {
      setSaving(false);
    }
  };

  const titleScope = scope === "family" ? "Family" : "Agent";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Edit ${titleScope} Memory` : `Add ${titleScope} Memory`}
          </DialogTitle>
        </DialogHeader>

        {scope === "family" && (
          <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-lg p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            This memory is shared across every agent you own.
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => v && setCategory(v as MemoryCategory)}
                disabled={isEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Key</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="favorite_editor"
                className="font-mono text-xs"
                disabled={isEdit}
              />
            </div>
          </div>
          {isEdit && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              Category and key identify this memory and can't be changed.
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Content</Label>
            <Textarea
              className="min-h-[100px] text-sm leading-relaxed resize-y"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What should be remembered..."
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short note about this memory..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Confidence (0–1)</Label>
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
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="work, tooling"
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
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Add Memory"}
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
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
