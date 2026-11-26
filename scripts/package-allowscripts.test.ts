/**
 * PACKAGE-ALLOWSCRIPTS-1: npm (11.16+) asks for dependency install scripts to be approved in package.json#allowScripts;
 * npm 12 skips unapproved ones. Approvals are name-only (`"pkg": true`, any version), like the two Prisma entries
 * that were already there; the format is the one npm's own matcher accepts (@npmcli/arborist lib/script-allowed.js:
 * a bare name matches every version; `pkg@1.2.3` only that version; semver ranges are ignored).
 *
 * (a) package.json still parses and allowScripts is exactly the approved set, all `true`, all name-only.
 * (b) Every lockfile package with install scripts is either approved or listed in NOT_APPROVED with a reason, so a new
 *     dependency with install scripts fails here until someone decides about it.
 * (c) The start scripts are unchanged.
 * (d) This task changed no dependency: versions, overrides and package-lock.json are identical between BASE (main
 *     5d66b64) and the commit that added the three approvals (or the working tree before that commit exists).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const BASE = "5d66b64";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));

/** Packages whose install scripts run on install (all name-only approvals). */
const APPROVED = {
  "@prisma/client": "postinstall: generates the Prisma client (already approved before this task)",
  "@prisma/engines": "postinstall: fetches the Prisma engine binaries for the build/runtime (already approved before this task)",
  esbuild: "postinstall: checks / falls back to fetching its platform binary (used by tsx: seed and scripts)",
  prisma: "preinstall: Node.js version check of the Prisma CLI (`prisma generate` runs in the build)",
  "unrs-resolver": "postinstall: checks / falls back to fetching its native binding (eslint-config-next import resolver)",
} as const;

/** Lockfile packages with install scripts that are deliberately NOT approved. */
const NOT_APPROVED = {
  fsevents: "optional, macOS-only (os: darwin) file watcher; never installed on Windows or the Linux server",
} as const;

test("(a) allowScripts is exactly the approved set, all true and name-only", () => {
  assert.equal(typeof pkg.allowScripts, "object");
  assert.deepEqual(Object.keys(pkg.allowScripts).sort(), Object.keys(APPROVED).sort());
  for (const [name, value] of Object.entries(pkg.allowScripts)) {
    assert.equal(value, true, `${name} must be approved with true`);
    assert.match(name, /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/, `${name} must be a bare package name (no version or range)`);
  }
});

test("(b) every lockfile package with install scripts is approved or deliberately not approved", () => {
  const withScripts = new Set<string>();
  for (const [path, entry] of Object.entries(lock.packages as Record<string, { hasInstallScript?: boolean }>)) {
    if (path && entry.hasInstallScript) withScripts.add(path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length));
  }
  assert.deepEqual([...withScripts].sort(), [...Object.keys(APPROVED), ...Object.keys(NOT_APPROVED)].sort());
  assert.equal(lock.packages["node_modules/fsevents"].optional, true);
  assert.deepEqual(lock.packages["node_modules/fsevents"].os, ["darwin"]);
});

test("(c) start and start:cluster are unchanged", () => {
  assert.equal(pkg.scripts.start, "next start");
  assert.equal(pkg.scripts["start:cluster"], "node scripts/cluster-start.mjs");
});

test("(d) no dependency, override or lockfile change in this task", () => {
  const added = git("log", "--format=%H", "-S", '"unrs-resolver": true', `${BASE}..HEAD`, "--", "package.json").trim().split(/\r?\n/).filter(Boolean);
  const task = added.at(-1); // oldest commit that added the approvals
  const after = task ? JSON.parse(git("show", `${task}:package.json`)) : pkg;
  const before = JSON.parse(git("show", `${BASE}:package.json`));
  for (const field of ["dependencies", "devDependencies", "overrides", "prisma", "engines"]) assert.deepEqual(after[field], before[field], field);
  const { allowScripts: _a, ...restAfter } = after;
  const { allowScripts: _b, ...restBefore } = before;
  assert.deepEqual(restAfter, restBefore, "only allowScripts may differ");
  const lockDiff = task ? git("diff", "--name-only", BASE, task, "--", "package-lock.json") : git("diff", "--name-only", BASE, "--", "package-lock.json");
  assert.equal(lockDiff.trim(), "");
});
