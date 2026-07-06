import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../stores/chatStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * "Rename to group" modal. When a DM becomes a group the server generates a
 * suggested name and pushes `conversation_rename_suggested`; this modal lets
 * the user accept, edit, or skip it, and optionally opt into auto-renaming
 * future groups. Rendered globally off `chatStore.pendingRename`; the server
 * broadcasts `conversation_rename_resolved` so answering on one device
 * dismisses it everywhere.
 */
export function RenameToGroupModal() {
  const { t } = useTranslation("chat");
  const pendingRename = useChatStore((s) => s.pendingRename);
  const respondToRename = useChatStore((s) => s.respondToRename);

  const [title, setTitle] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const convId = pendingRename?.conversationId;

  useEffect(() => {
    if (pendingRename) {
      setTitle(pendingRename.suggestedTitle);
      setRemember(false);
    }
  }, [pendingRename]);

  if (!pendingRename || !convId) return null;

  const submit = async (action: "accept" | "skip") => {
    setSubmitting(true);
    try {
      await respondToRename(
        convId,
        action,
        action === "accept" ? title.trim() : undefined,
        remember || undefined
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canAccept = title.trim().length > 0 && !submitting;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Closing via overlay/esc counts as "skip".
        if (!open && !submitting) submit("skip");
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("renameToGroup.title")}</DialogTitle>
          <DialogDescription>{t("renameToGroup.description")}</DialogDescription>
        </DialogHeader>

        <Input
          value={title}
          maxLength={60}
          placeholder={t("renameToGroup.placeholder")}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAccept) submit("accept");
          }}
          autoFocus
          disabled={submitting}
        />

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            disabled={submitting}
          />
          {t("renameToGroup.rememberChoice")}
        </label>

        <DialogFooter>
          <Button variant="ghost" onClick={() => submit("skip")} disabled={submitting}>
            {t("renameToGroup.skip")}
          </Button>
          <Button onClick={() => submit("accept")} disabled={!canAccept}>
            {t("renameToGroup.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
