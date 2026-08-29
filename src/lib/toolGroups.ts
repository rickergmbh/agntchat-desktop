import type { PlatformToolSummary } from "./api";

/**
 * Provider grouping for the integration-tool pickers (create wizard +
 * agent-details Tools tab). Providers are derived from the seeded tool
 * tags — there is no provider column on agent_tools.
 *
 * `credentialProvider` names the Connected-Accounts provider whose
 * credential the tools resolve at call time (null = public API / no
 * connection needed, or no in-app connect flow exists).
 */
export interface ToolGroup {
  key: "gmail" | "calendar" | "drive" | "github" | "jobs" | "payments" | "other";
  /** i18n key under the agents namespace */
  labelKey: string;
  credentialProvider: "google" | "github" | null;
  tools: PlatformToolSummary[];
}

const GROUP_DEFS: Array<{
  key: ToolGroup["key"];
  labelKey: string;
  credentialProvider: ToolGroup["credentialProvider"];
  matches: (tags: string[]) => boolean;
}> = [
  {
    key: "gmail",
    labelKey: "toolsTab.groups.gmail",
    credentialProvider: "google",
    matches: (tags) => tags.includes("gmail"),
  },
  {
    key: "calendar",
    labelKey: "toolsTab.groups.calendar",
    credentialProvider: "google",
    matches: (tags) => tags.includes("calendar"),
  },
  {
    key: "drive",
    labelKey: "toolsTab.groups.drive",
    credentialProvider: "google",
    matches: (tags) => tags.includes("drive"),
  },
  {
    key: "github",
    labelKey: "toolsTab.groups.github",
    credentialProvider: "github",
    matches: (tags) => tags.includes("github"),
  },
  {
    key: "jobs",
    labelKey: "toolsTab.groups.jobs",
    credentialProvider: null,
    matches: (tags) => tags.includes("jobs"),
  },
  {
    key: "payments",
    labelKey: "toolsTab.groups.payments",
    credentialProvider: null,
    matches: (tags) =>
      tags.includes("payments") || tags.includes("payment") || tags.includes("finance"),
  },
];

/** Group the catalog's integration tools (scope "agent") by provider. Groups
 *  come back in GROUP_DEFS order, empty groups omitted, leftovers in
 *  "other". Global/platform tools are excluded — they're always available. */
export function groupIntegrationTools(
  catalog: PlatformToolSummary[]
): ToolGroup[] {
  const integrations = catalog.filter((t) => t.scope === "agent");
  const seen = new Set<string>();
  const groups: ToolGroup[] = [];

  for (const def of GROUP_DEFS) {
    const tools = integrations.filter(
      (t) => !seen.has(t.id) && def.matches(t.tags ?? [])
    );
    tools.forEach((t) => seen.add(t.id));
    if (tools.length > 0) {
      groups.push({
        key: def.key,
        labelKey: def.labelKey,
        credentialProvider: def.credentialProvider,
        tools,
      });
    }
  }

  const leftovers = integrations.filter((t) => !seen.has(t.id));
  if (leftovers.length > 0) {
    groups.push({
      key: "other",
      labelKey: "toolsTab.groups.other",
      credentialProvider: null,
      tools: leftovers,
    });
  }

  return groups;
}

/** True when any of the given tool NAMES is a Google-credentialed tool in
 *  the catalog — drives the post-create "Connect Google" pane. */
export function anyGoogleTool(
  catalog: PlatformToolSummary[],
  names: string[]
): boolean {
  const set = new Set(names);
  return catalog.some(
    (t) => set.has(t.name) && (t.tags ?? []).includes("google")
  );
}
