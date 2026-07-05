// Thin PostHog wrapper (desktop copy of web's src/lib/analytics.ts — keep the
// two in sync). Enforces the consent gate in one place: nothing loads,
// initializes, or captures until a human with analyticsOptIn=true is
// identified. Person profiles are deliberately pseudonymous — participant id,
// never email or display name, and never message content.

import type { Participant } from "./api";

type PostHog = typeof import("posthog-js").default;

let posthog: PostHog | null = null;
let loadPromise: Promise<PostHog | null> | null = null;

// The PostHog project API key is write-only and public by design (it ships
// in every client bundle), so a committed default is fine; the env var is an
// override for forks/other environments.
const DEFAULT_KEY = "phc_nNXaeotVcJvuuW2zBseyPnENT4BanBJ8JFqpKjhPEdLj";
const KEY = import.meta.env.VITE_POSTHOG_KEY ?? DEFAULT_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? "https://eu.i.posthog.com";
const APP_VERSION = import.meta.env.VITE_GIT_COMMIT ?? "dev";

const PLATFORM = "desktop";

// Events captured between consent being confirmed and posthog-js finishing
// its dynamic import are queued and flushed after identify, so e.g.
// signup_completed (fired right after the first identify call) isn't lost.
const MAX_QUEUE = 50;
const preInitQueue: Array<{ event: string; props?: Record<string, unknown> }> = [];

function consented(p: Participant | null): p is Participant {
  return !!p && p.type === "human" && p.analyticsOptIn === true;
}

function load(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null);
  if (!loadPromise) {
    loadPromise = import("posthog-js")
      .then((m) => {
        const ph = m.default;
        ph.init(KEY, {
          api_host: HOST,
          // Explicit, named events only — autocapture is noise in a webview.
          autocapture: false,
          // Not a routed SPA: screen views are sent from navStore changes.
          capture_pageview: false,
          capture_pageleave: false,
          disable_session_recording: true,
          persistence: "localStorage+cookie",
        });
        posthog = ph;
        return ph;
      })
      .catch((err) => {
        console.error("PostHog init failed", err);
        return null;
      });
  }
  return loadPromise;
}

/**
 * Sync auth/consent state into analytics. Call with the self participant on
 * login/signup/profile-refresh and after any consent change; call with null
 * on logout. A non-consented (or absent) participant stops capture and drops
 * stored identifiers.
 */
export async function identifyAnalytics(p: Participant | null): Promise<void> {
  if (!KEY) return;

  if (!consented(p)) {
    preInitQueue.length = 0;
    if (posthog) {
      posthog.opt_out_capturing();
      posthog.reset();
    }
    return;
  }

  const ph = await load();
  if (!ph) return;
  if (ph.has_opted_out_capturing()) ph.opt_in_capturing();

  ph.identify(p.id, {
    locale: p.locale ?? undefined,
    timezone: p.timezone ?? undefined,
  });

  if (p.activeOrganizationId) {
    ph.group("organization", p.activeOrganizationId);
  }

  // Super properties ride on every event. $feature/<key> is PostHog's flag
  // convention, so insights can break down by our (backend-owned) flags.
  ph.register({
    platform: PLATFORM,
    app_version: APP_VERSION,
    ...featureProps(p.features),
  });

  for (const q of preInitQueue.splice(0)) {
    ph.capture(q.event, q.props);
  }
}

function featureProps(features?: Record<string, boolean>) {
  const out: Record<string, boolean> = {};
  for (const [key, on] of Object.entries(features ?? {})) {
    if (on) out[`$feature/${key}`] = true;
  }
  return out;
}

/**
 * Capture a product event. Safe to call unconditionally — a no-op unless a
 * consented user is identified (or identification is in flight, in which
 * case the event is queued). Event names live in ANALYTICS_EVENTS.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  if (posthog) {
    posthog.capture(event, props);
    return;
  }
  if (loadPromise && preInitQueue.length < MAX_QUEUE) {
    preInitQueue.push({ event, props });
  }
}

/** View change in the sidebar-nav shell — the desktop analog of a pageview. */
export function trackScreen(view: string): void {
  posthog?.capture("$screen", { $screen_name: view });
}

/**
 * Canonical event names (snake_case, object_verb, past tense). Must stay in
 * sync with the web and mobile copies of this module.
 */
export const ANALYTICS_EVENTS = {
  SIGNUP_COMPLETED: "signup_completed",
  LOGIN_COMPLETED: "login_completed",
  LOGOUT: "logout",
  AGENT_CREATED: "agent_created",
  CONVERSATION_CREATED: "conversation_created",
  MESSAGE_SENT: "message_sent",
  GOOGLE_ACCOUNT_CONNECTED: "google_account_connected",
  MEMBER_INVITED: "member_invited",
  INVITE_ACCEPTED: "invite_accepted",
} as const;
