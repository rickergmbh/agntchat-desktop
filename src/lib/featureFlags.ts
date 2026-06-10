// Single client-side gate for the multi-workspace ("organizations") feature.
//
// Default OFF: every user only ever uses their auto-created Personal
// workspace, so the app reads as "just your account" — no switcher, no
// create/settings/invite surfaces, no Personal-vs-Workspace agent toggle.
//
// The backend is unchanged and fully workspace-aware; this flag only hides
// client entry points. Flip to `true` to bring the whole feature back with
// no rework — the workspace components stay in the tree, just unmounted.
export const WORKSPACES_ENABLED = false;
