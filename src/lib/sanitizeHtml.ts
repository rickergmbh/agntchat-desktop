import DOMPurify from "dompurify";

/**
 * Sanitize agent- or template-authored HTML before it reaches
 * `dangerouslySetInnerHTML`.
 *
 * Result-presentation bodies, screenplay bodies, and template previews are
 * authored by LLMs (or, for templates, by other users) and rendered into the
 * DOM of everyone in a conversation. Without sanitizing, an agent could emit
 * `<img src=x onerror=…>` or `<script>` and run script in a peer's session —
 * stored XSS. react-markdown handles the normal message path safely; these
 * raw-HTML escape hatches did not, until this helper.
 *
 * Port of web/src/lib/sanitizeHtml.ts — keep the two in sync.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "style"],
  });
}
