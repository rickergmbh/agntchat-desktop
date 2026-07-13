// Thin PostHog wrapper (desktop copy of web's src/lib/analytics.ts — keep the
// two in sync). Enforces the consent gate in one place: nothing loads,
// initializes, or captures until a human with analyticsOptIn=true is
// identified. Person profiles are deliberately pseudonymous — participant id,
// never email or display name, and never message content.

import { getVersion } from "@tauri-apps/api/app";
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

// The version of the installed binary (src-tauri/tauri.conf.json), i.e. what
// "which version are users on" actually means for a desktop app. Resolved
// once; identify() awaits it so the super prop is never a placeholder.
const appVersion: Promise<string> = getVersion().catch(() => "unknown");

const PLATFORM = "desktop";

// Events captured before posthog-js is initialized (app just opened, consent
// not yet confirmed, or the dynamic import still in flight) are queued and
// flushed after a consented identify — so the launch $screen and
// signup_completed aren't lost to the init race. Nothing leaves the device
// unless consent is confirmed; a non-consented identify clears the queue.
const MAX_QUEUE = 50;
const preInitQueue: Array<{ event: string; props?: Record<string, unknown> }> = [];

// app_opened is the canonical activity event (DAU/retention). Fired on every
// consented identify and on window-visible transitions, deduped per local
// calendar day so an always-running desktop app still registers daily
// activity without spam.
let identifiedConsented = false;
let lastAppOpenedDay: string | null = null;

function maybeTrackAppOpened(): void {
  if (!identifiedConsented) return;
  const day = new Date().toDateString();
  if (day === lastAppOpenedDay) return;
  lastAppOpenedDay = day;
  track(ANALYTICS_EVENTS.APP_OPENED);
}

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
          // Flags are backend-owned (feature_flags table + Platform console);
          // PostHog's flag product is unused, so don't fetch (billable) flag
          // definitions. Our $feature/* super props still tag events.
          advanced_disable_feature_flags: true,
          persistence: "localStorage+cookie",
        });
        posthog = ph;
        // Long-running app: refocusing the window counts as activity even
        // without a view change.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") maybeTrackAppOpened();
        });
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
    identifiedConsented = false;
    lastAppOpenedDay = null;
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
    app_version: await appVersion,
    ...featureProps(p.features),
  });

  identifiedConsented = true;

  for (const q of preInitQueue.splice(0)) {
    ph.capture(q.event, q.props);
  }

  maybeTrackAppOpened();
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
  if (KEY && preInitQueue.length < MAX_QUEUE) {
    preInitQueue.push({ event, props });
  }
}

/** View change in the sidebar-nav shell — the desktop analog of a pageview. */
export function trackScreen(view: string): void {
  track("$screen", { $screen_name: view });
}

/**
 * Canonical event names (snake_case, object_verb, past tense). Must stay in
 * sync with the web and mobile copies of this module.
 */
export const ANALYTICS_EVENTS = {
  APP_OPENED: "app_opened",
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
