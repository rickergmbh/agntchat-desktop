/**
 * Freshness gate for view-level caches.
 *
 * Every sidebar view is unmounted when you navigate away (AppShell renders
 * one view at a time), so anything a view fetches in a mount effect is
 * re-fetched on every visit unless the data lives in a store *and* the fetch
 * is gated. Stores that hold view data therefore carry a `loadedAt` stamp and
 * expose a `fetchXIfStale()` companion:
 *
 *   - fresh cache  → serve what's in the store, no request
 *   - stale cache  → re-fetch, but keep rendering the cached rows meanwhile
 *                    (`loading` only blanks the view when there is nothing
 *                    cached to show)
 *
 * Live data — presence, streams, tasks, todos, messages — arrives over
 * WebSocket between visits, so the TTL only backstops what the socket misses.
 * Pick a shorter TTL for anything genuinely time-sensitive (agent health).
 */

/** Default view-cache lifetime. WS keeps these lists live in between. */
export const DEFAULT_TTL_MS = 60_000;

/** True while a `loadedAt` stamp is still inside its TTL. `0` = never loaded. */
export function isFresh(loadedAt: number, ttlMs: number = DEFAULT_TTL_MS): boolean {
  return loadedAt > 0 && Date.now() - loadedAt < ttlMs;
}
