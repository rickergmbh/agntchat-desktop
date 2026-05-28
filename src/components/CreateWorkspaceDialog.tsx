import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface Props {
  onClose: () => void;
}

/**
 * Small dialog for creating a new shared workspace from the
 * desktop switcher. Calls workspaceStore.createWorkspace, which
 * auto-switches into the new workspace on success.
 */
export function CreateWorkspaceDialog({ onClose }: Props) {
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createWorkspace(name.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create workspace");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-popover p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">New workspace</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="ws-name" className="text-xs font-medium">
              Name
            </label>
            <input
              id="ws-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Engineering"
              maxLength={100}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              You can rename it later. URL slug is derived from this.
            </p>
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {creating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
