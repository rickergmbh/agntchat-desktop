import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  FileText,
  Loader2,
  Plus,
  Save,
  Check,
  Copy,
  Trash2,
  AlertCircle,
  LayoutGrid,
  Hotel,
  Plane,
  UtensilsCrossed,
  CalendarDays,
  ShoppingBag,
  Mail,
  DollarSign,
  Contact,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatRelativeShort } from "../../lib/utils";
import { useTemplateStore } from "../../stores/templateStore";
import { FieldEditor } from "./FieldEditor";
import { TemplateCardPreview } from "../TemplateCardPreview";
import type { DetailField, ResponseTemplate, ResultType } from "../../lib/api";

const RESULT_TYPES: ResultType[] = [
  "hotel",
  "flight",
  "restaurant",
  "event",
  "product",
  "email",
  "finance",
  "contact",
  "generic",
];

const RESULT_TYPE_ICONS: Record<ResultType, typeof Hotel> = {
  hotel: Hotel,
  flight: Plane,
  restaurant: UtensilsCrossed,
  event: CalendarDays,
  product: ShoppingBag,
  email: Mail,
  finance: DollarSign,
  contact: Contact,
  generic: LayoutGrid,
};

function emptyField(): DetailField {
  return { key: "", display: "row" };
}

interface Props {
  template: ResponseTemplate | null;
  isNew: boolean;
}

export function TemplateEditor({ template, isNew }: Props) {
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const selectTemplate = useTemplateStore((s) => s.selectTemplate);
  const previewTemplate = useTemplateStore((s) => s.previewTemplate);

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [resultType, setResultType] = useState<ResultType>(
    (template?.resultType as ResultType) ?? "generic"
  );
  const [fields, setFields] = useState<DetailField[]>(
    template?.fields ?? [emptyField()]
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [previewHtml, setPreviewHtml] = useState("");
  const [previewCss, setPreviewCss] = useState("");
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const dirty = useMemo(() => {
    if (isNew) return true;
    return (
      name !== (template?.name ?? "") ||
      description !== (template?.description ?? "") ||
      resultType !== ((template?.resultType as ResultType) ?? "generic") ||
      JSON.stringify(fields) !== JSON.stringify(template?.fields ?? [])
    );
  }, [isNew, name, description, resultType, fields, template]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (isNew) {
        const created = await createTemplate({
          name: name.trim(),
          description: description || undefined,
          resultType,
          fields,
        });
        selectTemplate(created.id);
      } else if (template) {
        await updateTemplate(template.id, {
          name: name.trim(),
          description: description || undefined,
          resultType,
          fields,
        });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    name,
    description,
    resultType,
    fields,
    isNew,
    template,
    createTemplate,
    updateTemplate,
    selectTemplate,
  ]);

  const handleDelete = useCallback(async () => {
    if (!template) return;
    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`))
      return;
    setDeleting(true);
    setSaveError(null);
    try {
      await deleteTemplate(template.id);
      selectTemplate(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [template, deleteTemplate, selectTemplate]);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    setPreviewErrors([]);
    try {
      const result = await previewTemplate({
        name: name.trim(),
        resultType,
        fields,
      });
      setPreviewHtml(result.html);
      setPreviewCss(result.css);
      setPreviewErrors(result.errors);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate preview";
      setPreviewErrors([msg]);
    } finally {
      setPreviewing(false);
    }
  }, [name, resultType, fields, previewTemplate]);

  const specKey = useMemo(
    () => JSON.stringify({ name, resultType, fields }),
    [name, resultType, fields]
  );
  // Debounced auto-preview. Depend only on `specKey` — including `previewHtml`
  // here would risk re-firing after a successful preview landed. `handlePreview`
  // is read via a ref-like pattern by being stable against the same spec.
  const lastPreviewedKeyRef = useRef<string>("");
  useEffect(() => {
    if (!name.trim()) return;
    if (lastPreviewedKeyRef.current === specKey) return;
    lastPreviewedKeyRef.current = specKey;
    const timer = setTimeout(() => handlePreview(), 400);
    return () => clearTimeout(timer);
  }, [specKey, name, handlePreview]);

  const handleCopyId = useCallback(() => {
    if (!template) return;
    navigator.clipboard?.writeText(template.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1500);
  }, [template]);

  const updateField = useCallback((index: number, updated: DetailField) => {
    setFields((prev) => prev.map((f, i) => (i === index ? updated : f)));
  }, []);

  const removeField = useCallback((index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addField = useCallback(() => {
    setFields((prev) => [...prev, emptyField()]);
  }, []);

  const cardPreviewTemplate: ResponseTemplate | null = useMemo(() => {
    if (template) {
      return { ...template, name: name || template.name, resultType, fields };
    }
    if (isNew) {
      return {
        id: "new",
        name: name || "untitled",
        description,
        resultType,
        fields,
        insertedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return null;
  }, [template, isNew, name, description, resultType, fields]);

  const TypeIcon = RESULT_TYPE_ICONS[resultType];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-card px-6 py-2.5">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !name.trim() || !dirty}
        >
          {saving ? (
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          ) : saved ? (
            <Check className="mr-1.5 h-3 w-3" />
          ) : (
            <Save className="mr-1.5 h-3 w-3" />
          )}
          {saved ? "Saved" : isNew ? "Create Template" : "Save Changes"}
        </Button>
        {dirty && !saved && (
          <Badge variant="outline" className="text-[10px]">
            Unsaved
          </Badge>
        )}
        <div className="flex-1" />
        {!isNew && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3 w-3" />
            )}
            Delete
          </Button>
        )}
      </div>

      {saveError && (
        <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-6 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{saveError}</p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-5 space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <Badge variant="secondary" className="text-[10px] uppercase">
                {resultType}
              </Badge>
              {!isNew && template && (
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  title="Copy template ID"
                >
                  <span className="font-mono">
                    {template.id.slice(0, 8)}…
                  </span>
                  {copiedId ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <TypeIcon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-semibold font-mono leading-tight">
                  {isNew ? "New Template" : template?.name}
                </h1>
                {template?.updatedAt && !isNew && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Updated {formatRelativeShort(template.updatedAt)} ago
                  </p>
                )}
              </div>
            </div>
          </div>

          <Section label="Card Preview">
            {cardPreviewTemplate && cardPreviewTemplate.sampleData ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <TemplateCardPreview template={cardPreviewTemplate} />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
                No sample data on this template. The rendered HTML further down
                uses the server's preview pipeline regardless.
              </div>
            )}
          </Section>

          <Section label="Details">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Template Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="hotel_search_results"
                  className="h-9 font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  Use snake_case. This identifies the template in API calls.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this template display?"
                  rows={2}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Result Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {RESULT_TYPES.map((rt) => {
                    const Icon = RESULT_TYPE_ICONS[rt];
                    return (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => setResultType(rt)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                          resultType === rt
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            resultType === rt
                              ? "text-primary"
                              : "text-muted-foreground"
                          )}
                        />
                        <span className="text-xs font-medium capitalize">
                          {rt}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Section>

          <Section
            label="Rendered HTML"
            right={
              <Button
                size="sm"
                variant="ghost"
                onClick={handlePreview}
                disabled={previewing || !name.trim()}
                className="h-6 px-2 text-[11px]"
              >
                {previewing ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Eye className="mr-1 h-3 w-3" />
                )}
                Refresh
              </Button>
            }
          >
            {previewErrors.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {previewErrors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2"
                  >
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    <p className="text-xs text-destructive">{err}</p>
                  </div>
                ))}
              </div>
            )}

            {previewing && !previewHtml ? (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : previewHtml ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <div
                  className="p-4"
                  dangerouslySetInnerHTML={{
                    __html: `<style>${previewCss}</style>${previewHtml}`,
                  }}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                Set a template name above to generate a preview.
              </div>
            )}
          </Section>

          <Section
            label={`Fields (${fields.length})`}
            right={
              <Button
                size="sm"
                variant="ghost"
                onClick={addField}
                className="h-6 px-2 text-[11px]"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Field
              </Button>
            }
          >
            {fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <LayoutGrid className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">
                  No fields defined yet. Add one to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <FieldEditor
                    key={index}
                    field={field}
                    onChange={(updated) => updateField(index, updated)}
                    onDelete={() => removeField(index)}
                  />
                ))}
              </div>
            )}
          </Section>

          {template && !isNew && (
            <Section label="Raw JSON">
              <pre className="rounded-lg border border-border bg-muted/30 p-3 text-[11px] overflow-x-auto">
                {JSON.stringify(template, null, 2)}
              </pre>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function TemplatesEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      <div className="text-center">
        <FileText className="mx-auto h-12 w-12 text-muted-foreground/40 mb-3" />
        <h2 className="text-sm font-medium text-foreground">
          Select a template
        </h2>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          Pick one from the left to see its preview, fields, and raw JSON.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button size="sm" onClick={onCreate}>
            <Plus className="mr-1.5 h-3 w-3" />
            Create Template
          </Button>
        </div>
      </div>
    </div>
  );
}
