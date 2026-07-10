import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  type Skill,
  getAgentSkills,
  listSkills,
  assignSkill,
  unassignSkill,
  updateSkill,
  createSkill,
  importSkill,
  installMarketplaceSkill,
  deleteSkill,
} from "../lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  Sparkles,
  Plus,
  Download,
  ChevronRight,
  Globe,
  User,
  Link2,
  Eye,
  Copy,
  Check,
  Pencil,
  Unlink,
  Trash2,
} from "lucide-react";

interface AgentSkillsProps {
  agentId: string;
}

export function AgentSkills({ agentId }: AgentSkillsProps) {
  const { t } = useTranslation("agents");
  const [resolvedSkills, setResolvedSkills] = useState<Skill[]>([]);
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showInstallShared, setShowInstallShared] = useState(false);
  const [viewSkill, setViewSkill] = useState<Skill | null>(null);
  const [editingSkill, setEditingSkill] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      const [resolved, available] = await Promise.all([
        getAgentSkills(agentId),
        listSkills(),
      ]);
      setResolvedSkills(resolved.skills || []);
      setAllSkills(available.skills || []);
    } catch (e) {
      console.error("Failed to fetch skills:", e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const resolvedNames = new Set(resolvedSkills.map((s) => s.name));
  const unassignedSkills = allSkills.filter((s) => !resolvedNames.has(s.name));

  // Group resolved skills by source
  const globalSkills = resolvedSkills.filter((s) => s.scope === "global");
  const ownerSkills = resolvedSkills.filter((s) => s.scope === "owner");
  const agentSkills = resolvedSkills.filter((s) => s.scope === "agent");

  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  const handleAssign = async (skillId: string) => {
    setAssigning(skillId);
    setAssignError(null);
    try {
      await assignSkill(skillId, agentId);
      await fetchSkills();
      setShowAdd(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("skills.errors.assignFailed");
      console.error("Failed to assign skill:", msg);
      setAssignError(msg);
    } finally {
      setAssigning(null);
    }
  };

  const handleUnassign = async (skill: Skill) => {
    try {
      await unassignSkill(skill.id, agentId);
      setViewSkill(null);
      await fetchSkills();
    } catch (e) {
      console.error("Failed to unassign skill:", e);
    }
  };

  const handleDelete = async (skill: Skill) => {
    setDeleting(true);
    try {
      await deleteSkill(skill.id);
      setViewSkill(null);
      setConfirmingDelete(false);
      await fetchSkills();
    } catch (e) {
      console.error("Failed to delete skill:", e);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("skills.loading")}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      {resolvedSkills.length === 0 ? (
        <div className="text-center py-8">
          <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">{t("skills.emptyTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("skills.emptyHint")}
          </p>
          <div className="flex gap-2 justify-center mt-4">
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("skills.addSkill")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
              {t("skills.createNew")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowInstallShared(true)}>
              <Link2 className="w-3.5 h-3.5 mr-1.5" /> {t("skills.installShared")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Action toolbar — kept at the top so the primary actions are
              reachable without scrolling past the skill list. */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("skills.addSkill")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
              {t("skills.createNew")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> {t("skills.import")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowInstallShared(true)}>
              <Link2 className="w-3.5 h-3.5 mr-1.5" /> {t("skills.installShared")}
            </Button>
          </div>

          {globalSkills.length > 0 && (
            <SkillGroup
              label={t("skills.scope.global")}
              icon={<Globe className="w-3 h-3" />}
              skills={globalSkills}
              onView={setViewSkill}
            />
          )}
          {ownerSkills.length > 0 && (
            <SkillGroup
              label={t("skills.scope.owner")}
              icon={<User className="w-3 h-3" />}
              skills={ownerSkills}
              onView={setViewSkill}

            />
          )}
          {agentSkills.length > 0 && (
            <SkillGroup
              label={t("skills.scope.agent")}
              icon={<Link2 className="w-3 h-3" />}
              skills={agentSkills}
              onView={setViewSkill}

            />
          )}
        </>
      )}

      {/* View/Edit Skill Dialog */}
      <Dialog open={!!viewSkill} onOpenChange={() => { setViewSkill(null); setEditingSkill(false); setCopied(false); setConfirmingDelete(false); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewSkill?.displayName}</DialogTitle>
          </DialogHeader>
          {viewSkill && !editingSkill && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{viewSkill.description}</p>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="secondary">{t(`skills.scope.${viewSkill.scope}`, viewSkill.scope)}</Badge>
                {viewSkill.category && (
                  <Badge variant="outline">
                    {t(`skills.category.${viewSkill.category}`, viewSkill.category)}
                  </Badge>
                )}
                {viewSkill.alwaysInject && <Badge>{t("skills.alwaysLoaded")}</Badge>}
                {viewSkill.visibility === "public" && (
                  <Badge variant="default" className="bg-success">{t("skills.visibility.public")}</Badge>
                )}
                {viewSkill.visibility === "unlisted" && (
                  <Badge variant="secondary">{t("skills.visibility.unlisted")}</Badge>
                )}
                {viewSkill.tags?.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                ))}
              </div>
              {(viewSkill.ratingAvg || viewSkill.installCount) && (
                <div className="flex gap-4 text-xs text-muted-foreground">
                  {viewSkill.ratingAvg != null && (
                    <span>
                      {t("skills.rating", {
                        rating: viewSkill.ratingAvg.toFixed(1),
                        count: viewSkill.ratingCount,
                      })}
                    </span>
                  )}
                  {viewSkill.installCount != null && viewSkill.installCount > 0 && (
                    <span>{t("skills.installs", { count: viewSkill.installCount })}</span>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingSkill(true)}>
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> {t("common:edit")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-muted-foreground hover:text-foreground"
                  onClick={() => handleUnassign(viewSkill)}
                >
                  <Unlink className="w-3.5 h-3.5 mr-1.5" /> {t("common:remove")}
                </Button>
              </div>

              {/* Delete skill (permanently) */}
              {confirmingDelete ? (
                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-destructive/30 bg-destructive/5">
                  <p className="text-xs text-destructive flex-1">
                    {t("skills.deleteConfirm")}
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(viewSkill)}
                    disabled={deleting}
                  >
                    {deleting ? t("common:deleting") : t("common:delete")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    {t("common:cancel")}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive/90"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t("skills.deleteSkill")}
                </Button>
              )}

              {/* Share button */}
              {(viewSkill.visibility === "public" || viewSkill.visibility === "unlisted") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard.writeText(viewSkill.id);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? (
                    <><Check className="w-3.5 h-3.5 mr-1.5 text-success" /> {t("common:copied")}</>
                  ) : (
                    <><Copy className="w-3.5 h-3.5 mr-1.5" /> {t("skills.copyIdToShare")}</>
                  )}
                </Button>
              )}

              <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {viewSkill.promptContent}
              </div>
            </div>
          )}

          {/* Edit mode */}
          {viewSkill && editingSkill && (
            <EditSkillForm
              skill={viewSkill}
              onSave={async (updated) => {
                setViewSkill(updated);
                setEditingSkill(false);
                await fetchSkills();
              }}
              onCancel={() => setEditingSkill(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Add Skill Dialog */}
      <AddSkillDialog
        open={showAdd}
        onClose={() => { setShowAdd(false); setAssignError(null); }}
        skills={unassignedSkills}
        onAssign={handleAssign}
        assigningId={assigning}
        error={assignError}
      />

      {/* Create Skill Dialog */}
      <CreateSkillDialog
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          fetchSkills();
        }}
        agentId={agentId}
      />

      {/* Import Skill Dialog */}
      <ImportSkillDialog
        open={showImport}
        onClose={() => {
          setShowImport(false);
          fetchSkills();
        }}
      />

      {/* Install Shared Skill Dialog */}
      <InstallSharedDialog
        open={showInstallShared}
        onClose={() => {
          setShowInstallShared(false);
          fetchSkills();
        }}
        agentId={agentId}
      />
    </div>
  );
}

// --- Skill Group ---

function SkillGroup({
  label,
  icon,
  skills,
  onView,
}: {
  label: string;
  icon: React.ReactNode;
  skills: Skill[];
  onView: (s: Skill) => void;
}) {
  const { t } = useTranslation("agents");
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="space-y-1">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="flex items-center justify-between p-2.5 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
            onClick={() => onView(skill)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{skill.displayName}</span>
                {skill.alwaysInject && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {t("skills.autoBadge")}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {skill.description.slice(0, 80)}{skill.description.length > 80 ? "..." : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 ml-2">
              <Eye className="w-3.5 h-3.5 text-muted-foreground" />
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Add Skill Dialog ---

function AddSkillDialog({
  open,
  onClose,
  skills,
  onAssign,
  assigningId,
  error,
}: {
  open: boolean;
  onClose: () => void;
  skills: Skill[];
  onAssign: (skillId: string) => void;
  assigningId: string | null;
  error: string | null;
}) {
  const { t } = useTranslation("agents");
  const [search, setSearch] = useState("");

  const filtered = skills.filter(
    (s) =>
      s.name.includes(search.toLowerCase()) ||
      s.displayName.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("skills.addSkill")}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder={t("skills.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3"
        />
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-md mb-2">
            {error}
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {skills.length === 0 ? t("skills.allAttached") : t("skills.noMatches")}
          </p>
        ) : (
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {filtered.map((skill) => (
              <div
                key={skill.id}
                className={`flex items-center justify-between p-2.5 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors ${assigningId === skill.id ? "opacity-50 pointer-events-none" : ""}`}
                onClick={() => !assigningId && onAssign(skill.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{skill.displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {skill.description.slice(0, 60)}
                  </p>
                </div>
                {assigningId === skill.id ? (
                  <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">{t("skills.adding")}</span>
                ) : (
                  <Plus className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 ml-2" />
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Create Skill Dialog ---

function CreateSkillDialog({
  open,
  onClose,
  agentId,
}: {
  open: boolean;
  onClose: () => void;
  agentId: string;
}) {
  const { t } = useTranslation("agents");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("integration");
  const [scope, setScope] = useState("owner");
  const [promptContent, setPromptContent] = useState("");
  const [alwaysInject, setAlwaysInject] = useState(false);
  const [visibility, setVisibility] = useState("private");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { skill } = await createSkill({
        name,
        displayName,
        description,
        promptContent,
        scope,
        category,
        alwaysInject,
        visibility: visibility as "private" | "public" | "unlisted",
      });
      // Auto-assign to this agent if agent-scoped
      if (scope === "agent" || scope === "owner") {
        try {
          await assignSkill(skill.id, agentId);
        } catch {
          // Assignment may fail if activation rules don't match — that's OK
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("skills.errors.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  // Auto-generate name from display name
  const handleDisplayNameChange = (val: string) => {
    setDisplayName(val);
    if (!name || name === autoName(displayName)) {
      setName(autoName(val));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("skills.createSkill")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.fields.displayName")}</Label>
              <Input
                value={displayName}
                onChange={(e) => handleDisplayNameChange(e.target.value)}
                placeholder={t("skills.fields.displayNamePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.fields.nameSlug")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="gmail-integration"
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("skills.fields.description")}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("skills.fields.descriptionPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.fields.category")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? "integration")}>
                <SelectTrigger>
                  <SelectValue>
                    {(val: unknown) => t(`skills.category.${String(val)}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="integration">{t("skills.category.integration")}</SelectItem>
                  <SelectItem value="formatting">{t("skills.category.formatting")}</SelectItem>
                  <SelectItem value="workflow">{t("skills.category.workflow")}</SelectItem>
                  <SelectItem value="api">{t("skills.category.api")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.fields.scope")}</Label>
              <Select value={scope} onValueChange={(v) => setScope(v ?? "owner")}>
                <SelectTrigger>
                  <SelectValue>
                    {(val: unknown) => t(`skills.scopeOption.${String(val)}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">{t("skills.scopeOption.owner")}</SelectItem>
                  <SelectItem value="agent">{t("skills.scopeOption.agent")}</SelectItem>
                  <SelectItem value="global">{t("skills.scopeOption.global")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={alwaysInject} onCheckedChange={setAlwaysInject} />
              <Label className="text-xs">{t("skills.alwaysInject")}</Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.fields.visibility")}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v ?? "private")}>
                <SelectTrigger>
                  <SelectValue>
                    {(val: unknown) =>
                      String(val) === "public"
                        ? t("skills.visibilityOption.publicMarketplace")
                        : t(`skills.visibilityOption.${String(val)}`)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">{t("skills.visibilityOption.private")}</SelectItem>
                  <SelectItem value="public">{t("skills.visibilityOption.publicMarketplace")}</SelectItem>
                  <SelectItem value="unlisted">{t("skills.visibilityOption.unlisted")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("skills.fields.instructions")}</Label>
            <Textarea
              className="min-h-[200px] font-mono text-sm leading-relaxed resize-y"
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
              placeholder={t("skills.fields.instructionsPlaceholder")}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            onClick={handleCreate}
            disabled={creating || !name || !description || !promptContent}
            className="w-full"
          >
            {creating ? t("skills.creating") : t("skills.createSkill")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Import Skill Dialog ---

function ImportSkillDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("agents");
  const [url, setUrl] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"url" | "paste">("url");

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      if (mode === "url") {
        await importSkill({ url });
      } else {
        await importSkill({ content: rawContent });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("skills.errors.importFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("skills.importSkill")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "url" ? "default" : "outline"}
              onClick={() => setMode("url")}
            >
              {t("skills.importFromUrl")}
            </Button>
            <Button
              size="sm"
              variant={mode === "paste" ? "default" : "outline"}
              onClick={() => setMode("paste")}
            >
              {t("skills.importPaste")}
            </Button>
          </div>

          {mode === "url" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.fields.githubUrl")}</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/anthropics/skills/tree/main/skills/pdf"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("skills.importUrlHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("skills.fields.skillMdContent")}</Label>
              <Textarea
                className="min-h-[200px] font-mono text-sm leading-relaxed resize-y"
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
                placeholder={"---\nname: my-skill\ndescription: What it does\n---\n\n# Instructions..."}
              />
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            onClick={handleImport}
            disabled={importing || (mode === "url" ? !url : !rawContent)}
            className="w-full"
          >
            {importing ? t("skills.importing") : t("skills.importSkill")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit Skill Form ---

function EditSkillForm({
  skill,
  onSave,
  onCancel,
}: {
  skill: Skill;
  onSave: (updated: Skill) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("agents");
  const [displayName, setDisplayName] = useState(skill.displayName);
  const [description, setDescription] = useState(skill.description);
  const [promptContent, setPromptContent] = useState(skill.promptContent);
  const [category, setCategory] = useState(skill.category || "integration");
  const [visibility, setVisibility] = useState(skill.visibility || "private");
  const [alwaysInject, setAlwaysInject] = useState(skill.alwaysInject);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { skill: updated } = await updateSkill(skill.id, {
        displayName,
        description,
        promptContent,
        category,
        visibility,
        alwaysInject,
      });
      onSave(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("skills.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">{t("skills.fields.displayName")}</Label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("skills.fields.description")}</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("skills.fields.category")}</Label>
          <Select value={category} onValueChange={(v) => setCategory(v ?? "integration")}>
            <SelectTrigger>
              <SelectValue>
                {(val: unknown) => t(`skills.category.${String(val)}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="integration">{t("skills.category.integration")}</SelectItem>
              <SelectItem value="formatting">{t("skills.category.formatting")}</SelectItem>
              <SelectItem value="workflow">{t("skills.category.workflow")}</SelectItem>
              <SelectItem value="api">{t("skills.category.api")}</SelectItem>
              <SelectItem value="development">{t("skills.category.development")}</SelectItem>
              <SelectItem value="testing">{t("skills.category.testing")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("skills.fields.visibility")}</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v ?? "private")}>
            <SelectTrigger>
              <SelectValue>
                {(val: unknown) =>
                  String(val) === "public"
                    ? t("skills.visibilityOption.publicMarketplace")
                    : t(`skills.visibilityOption.${String(val)}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">{t("skills.visibilityOption.private")}</SelectItem>
              <SelectItem value="public">{t("skills.visibilityOption.publicMarketplace")}</SelectItem>
              <SelectItem value="unlisted">{t("skills.visibilityOption.unlistedShareable")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch checked={alwaysInject} onCheckedChange={setAlwaysInject} />
        <Label className="text-xs">{t("skills.alwaysInjectIntoPrompt")}</Label>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("skills.fields.instructions")}</Label>
        <Textarea
          className="min-h-[200px] font-mono text-sm leading-relaxed resize-y"
          value={promptContent}
          onChange={(e) => setPromptContent(e.target.value)}
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving || !description || !promptContent} className="flex-1">
          {saving ? t("common:saving") : t("common:saveChanges")}
        </Button>
        <Button variant="outline" onClick={onCancel} className="flex-1">
          {t("common:cancel")}
        </Button>
      </div>
    </div>
  );
}

// --- Install Shared Skill Dialog ---

function InstallSharedDialog({
  open,
  onClose,
  agentId,
}: {
  open: boolean;
  onClose: () => void;
  agentId: string;
}) {
  const { t } = useTranslation("agents");
  const [skillId, setSkillId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    setSuccess(null);
    try {
      const { skill } = await installMarketplaceSkill(skillId.trim());
      // Auto-assign to this agent
      try {
        await assignSkill(skill.id, agentId);
      } catch {
        // Assignment may fail if activation rules don't match
      }
      setSuccess(t("skills.installSharedDialog.installedSuccess", { name: skill.displayName }));
      setSkillId("");
      setTimeout(onClose, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("skills.errors.installFailed"));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("skills.installSharedDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("skills.installSharedDialog.description")}
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("skills.installSharedDialog.skillIdLabel")}</Label>
            <Input
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              placeholder={t("skills.installSharedDialog.skillIdPlaceholder")}
              className="font-mono text-xs"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && <p className="text-xs text-success">{success}</p>}

          <Button
            onClick={handleInstall}
            disabled={installing || !skillId.trim()}
            className="w-full"
          >
            {installing ? t("skills.installSharedDialog.installing") : t("skills.installSharedDialog.install")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Helpers ---

function autoName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
