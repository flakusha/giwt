// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Store resolution + project-dir exposure for the intercom store.
 *
 * The durable store lives under the XDG **state** tier
 * (`${XDG_STATE_HOME|$HOME/.local/state}/giwt/intercom/<project-id>/`) —
 * coordination evidence is not regenerable, so cache semantics are wrong.
 * The project dir exposes it via the `.tmp/intercom` symlink so harnesses
 * and lane agents confined to the project dir keep working with unchanged
 * paths. The link is created ONLY by `giwt intercom init`, never in the
 * per-command hot path, via lstat → correct-target no-op → wrong-target
 * refuse → atomic temp+rename.
 *
 * Env seam (house pattern, mirrors GIWT_CHECK_SLOT_DIR):
 * - GIWT_INTERCOM_STATE_DIR  override the state root (tests; hermetic
 *   fixtures). Documented in AGENTS.md — tests and the doctor agree on it.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { log } from "../utils/output";
import { type ProjectIdentity, projectIdentity } from "./ids";

export const LINK_NAME = "intercom";
export const PROJECT_META = "project.json";
export const EVENTS_FILE = "events.jsonl";
export const ARCHIVE_DIR = "archive";

/** On-disk store metadata written (and drift-checked) by init. */
export interface ProjectMeta {
  v: 1;
  key: string;
  kind: "url" | "path";
  slug: string;
  /** For path-kind keys: the realpath the store was keyed on. gc treats a
   *  store whose repoPath no longer exists as orphaned. */
  repoPath?: string;
  backend: "jsonl" | "pijul";
  createdAt: string;
}

/** State root: user state dir, overridable for hermetic tests. */
export function intercomStateRoot(): string {
  const override = process.env.GIWT_INTERCOM_STATE_DIR;
  if (override !== undefined && override.trim().length > 0) return resolve(override);
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateHome, "giwt", "intercom");
}

/** Store dir for a project identity: `<stateRoot>/<slug>-<hash16>/`. */
export function storeDirFor(identity: ProjectIdentity): string {
  return join(intercomStateRoot(), identity.dirName);
}

/** Read `project.json` from a store; null when absent/corrupt. */
export function readProjectMeta(storeDir: string): ProjectMeta | null {
  try {
    const raw = readFileSync(join(storeDir, PROJECT_META), "utf8");
    const parsed = JSON.parse(raw) as ProjectMeta;
    return parsed.v === 1 && typeof parsed.key === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Create the store directory + metadata. Idempotent: an existing valid
 * store is left untouched (its backend is returned so callers can detect a
 * backend flip); a store with NO metadata adopts the current identity.
 * Throws with a remedy when a backend flip is attempted on a non-empty
 * store — re-keying the engine by hand would strand half the evidence.
 */
export function ensureStore(identity: ProjectIdentity, backend: "jsonl" | "pijul"): {
  storeDir: string;
  created: boolean;
  existingBackend: "jsonl" | "pijul" | null;
} {
  const storeDir = storeDirFor(identity);
  const created = !existsSync(storeDir);
  if (created) mkdirSync(storeDir, { recursive: true });
  mkdirSync(join(storeDir, ARCHIVE_DIR), { recursive: true });
  const existing = readProjectMeta(storeDir);
  if (existing === null) {
    const meta: ProjectMeta = {
      v: 1,
      key: identity.key,
      kind: identity.kind,
      slug: identity.slug,
      backend,
      createdAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      ...(identity.repoPath !== undefined ? { repoPath: identity.repoPath } : {}),
    };
    writeFileSync(join(storeDir, PROJECT_META), `${JSON.stringify(meta, null, 2)}\n`);
    return { storeDir, created, existingBackend: null };
  }
  if (existing.backend !== backend) {
    throw new Error(
      `${storeDir}: store backend is "${existing.backend}" but settings say "${backend}" — `
        + `flip [intercom] backend back, or start a fresh store (remove this dir)`,
    );
  }
  return { storeDir, created, existingBackend: existing.backend };
}

/** Lifecycle states of the `.tmp/intercom` exposure link. */
export type LinkStatus =
  | { state: "absent"; }
  | { state: "ok"; target: string; }
  | { state: "wrong"; current: string; isDir: boolean; }
  | { state: "dangling"; current: string; };

/** Lstat the exposure link in a checkout's `.tmp/` (read-only). */
export function linkStatus(worktreeRoot: string, storeDir: string): LinkStatus {
  const link = join(worktreeRoot, ".tmp", LINK_NAME);
  let st;
  try {
    st = lstatSync(link);
  } catch {
    return { state: "absent" };
  }
  if (st.isSymbolicLink()) {
    const target = readlinkSync(link);
    if (target === storeDir) return { state: "ok", target };
    return existsSync(link)
      ? { state: "wrong", current: target, isDir: false }
      : { state: "dangling", current: target };
  }
  return { state: "wrong", current: link, isDir: st.isDirectory() };
}

/**
 * Ensure `.tmp/intercom` → `storeDir` in this checkout. Throws with a
 * remedy on a wrong target or a real directory (legacy migration) —
 * never silently re-points a link a human may have set up deliberately.
 * Symlink-unsupported platforms (EPERM/ENOSYS) degrade to a real empty
 * directory with one warning line — per-checkout durability only.
 */
export function ensureLink(worktreeRoot: string, storeDir: string): void {
  const tmpDir = join(worktreeRoot, ".tmp");
  mkdirSync(tmpDir, { recursive: true });
  const link = join(tmpDir, LINK_NAME);
  const status = linkStatus(worktreeRoot, storeDir);
  if (status.state === "ok") return;
  if (status.state === "dangling") {
    // Re-link over the dead link via temp+rename (atomic replace).
    replaceLink(link, storeDir);
    return;
  }
  if (status.state === "wrong") {
    throw new Error(
      `${link}: ${status.isDir ? "a real directory" : `a symlink to ${status.current}`} — `
        + `expected ${storeDir}. ${
          status.isDir
            ? `Legacy layout: move its contents into the store, then re-run init.`
            : `Remove it or run init from the checkout that owns it.`
        }`,
    );
  }
  createLink(link, storeDir, worktreeRoot);
}

function replaceLink(link: string, storeDir: string): void {
  const tmp = `${link}.tmp.${process.pid}`;
  symlinkSync(storeDir, tmp);
  renameSync(tmp, link);
}

function createLink(link: string, storeDir: string, worktreeRoot: string): void {
  try {
    const tmp = `${link}.tmp.${process.pid}`;
    symlinkSync(storeDir, tmp);
    renameSync(tmp, link);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "ENOSYS") throw error;
    // Windows/WSL DrFsF fallback: real dir, one warning, per-checkout only.
    mkdirSync(link, { recursive: true });
    log(
      "warn",
      `${worktreeRoot}/.tmp/${LINK_NAME}: symlinks unsupported (${code}) — degraded to a real directory; cross-checkout coordination is OFF on this checkout`,
    );
  }
}

/**
 * Resolve the EXISTING store for this project — read/claim/gc path. No
 * creation and no link management (that is init's job alone, per design);
 * a missing store is a usage error naming the remedy.
 */
export function resolveExistingStore(repoRoot: string): {
  identity: ProjectIdentity;
  storeDir: string;
  meta: ProjectMeta | null;
} {
  const identity = projectIdentity(repoRoot);
  const storeDir = storeDirFor(identity);
  if (!existsSync(storeDir)) {
    throw new Error(
      `intercom: no store for this project yet (${storeDir}) — run 'giwt intercom init' first`,
    );
  }
  return { identity, storeDir, meta: readProjectMeta(storeDir) };
}
