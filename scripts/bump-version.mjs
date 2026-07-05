// Bump the desktop app version everywhere it lives, in one shot:
//   package.json, package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
//
// Usage:  npm run bump patch|minor|major|<x.y.z>
//
// Run this as the FIRST step of every release build ("npm run bump patch &&
// npm run tauri build"). The Tauri version (tauri.conf.json) is what installed
// apps report to analytics (see src/lib/analytics.ts) — if it doesn't move per
// release, the "Desktop users by app version" chart can't show migration.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];

if (!arg) {
  console.error("Usage: npm run bump patch|minor|major|<x.y.z>");
  process.exit(1);
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

function next(cur, spec) {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const [ma, mi, pa] = cur.split(".").map(Number);
  if (spec === "major") return `${ma + 1}.0.0`;
  if (spec === "minor") return `${ma}.${mi + 1}.0`;
  if (spec === "patch") return `${ma}.${mi}.${pa + 1}`;
  console.error(`Not a version or bump kind: ${spec}`);
  process.exit(1);
}

const version = next(current, arg);

// package.json
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// package-lock.json (root entry + the "" package)
const lockPath = join(root, "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
lock.version = version;
if (lock.packages && lock.packages[""]) lock.packages[""].version = version;
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");

// src-tauri/tauri.conf.json — the version the installed binary reports
const confPath = join(root, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

// src-tauri/Cargo.toml — first `version = "..."` line (the [package] entry)
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/^version = ".*"$/m, `version = "${version}"`));

console.log(`${current} -> ${version}`);
console.log("Updated: package.json, package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml");
console.log("Note: Cargo.lock updates itself on the next build. Commit the bump with the release.");
