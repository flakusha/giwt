// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Store resolution + symlink mechanics: the GIWT_INTERCOM_STATE_DIR env
 * seam, store creation/idempotency/backend-flip refusal, and the
 * `.tmp/intercom` link lifecycle (absent → create via temp+rename, correct
 * no-op, wrong target refused, dangling repaired, real dir refused).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import { type ProjectIdentity, projectIdentity } from "./ids";
import {
  ensureLink,
  ensureStore,
  intercomStateRoot,
  linkStatus,
  readProjectMeta,
  resolveExistingStore,
  storeDirFor,
} from "./store";

const tempRoots: string[] = [];
let stateDir = "";
let checkout = "";

beforeEach(() => {
  stateDir = mkdtempSync(join(scratchRoot(), "giwt-intercom-state-"));
  checkout = mkdtempSync(join(scratchRoot(), "giwt-intercom-co-"));
  tempRoots.push(stateDir, checkout);
  execFileSync("git", ["init", "-q", checkout], { env: isolatedGitEnv() });
  process.env.GIWT_INTERCOM_STATE_DIR = stateDir;
});

afterEach(() => {
  delete process.env.GIWT_INTERCOM_STATE_DIR;
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function identity(): ProjectIdentity {
  return projectIdentity(checkout);
}

describe("intercomStateRoot env seam", () => {
  it("honors GIWT_INTERCOM_STATE_DIR over the XDG default", () => {
    expect(intercomStateRoot()).toBe(stateDir);
    delete process.env.GIWT_INTERCOM_STATE_DIR;
    const prevXdg = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = join(stateDir, "xdg");
    expect(intercomStateRoot()).toBe(join(stateDir, "xdg", "giwt", "intercom"));
    delete process.env.XDG_STATE_HOME;
    if (prevXdg !== undefined) process.env.XDG_STATE_HOME = prevXdg;
  });
});

describe("ensureStore", () => {
  it("creates the store + archive dir and writes adoptable metadata", () => {
    const id = identity();
    const { storeDir, created, existingBackend } = ensureStore(id, "jsonl");
    expect(created).toBe(true);
    expect(existingBackend).toBe(null);
    expect(storeDir).toBe(storeDirFor(id));
    expect(existsSync(join(storeDir, "archive"))).toBe(true);
    const meta = readProjectMeta(storeDir);
    expect(meta?.key).toBe(id.key);
    expect(meta?.backend).toBe("jsonl");
  });

  it("is idempotent and refuses a backend flip", () => {
    const id = identity();
    ensureStore(id, "jsonl");
    const again = ensureStore(id, "jsonl");
    expect(again.created).toBe(false);
    expect(again.existingBackend).toBe("jsonl");
    expect(() => ensureStore(id, "pijul")).toThrow(/backend is "jsonl"/);
  });

  it("adopts metadata for a bare store dir left by an older giwt", () => {
    const id = identity();
    mkdirSync(storeDirFor(id), { recursive: true });
    const { created, existingBackend } = ensureStore(id, "jsonl");
    expect(created).toBe(false);
    expect(existingBackend).toBe(null);
    expect(readProjectMeta(storeDirFor(id))?.key).toBe(id.key);
  });
});

describe("ensureLink / linkStatus", () => {
  it("creates the link atomically and is a no-op when correct", () => {
    const { storeDir } = ensureStore(identity(), "jsonl");
    ensureLink(checkout, storeDir);
    expect(lstatSync(join(checkout, ".tmp", "intercom")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(checkout, ".tmp", "intercom"))).toBe(storeDir);
    expect(linkStatus(checkout, storeDir)).toEqual({ state: "ok", target: storeDir });
    // No-op second run: same target, no temp link files left behind.
    ensureLink(checkout, storeDir);
    expect(readdirSync(join(checkout, ".tmp"))).toEqual(["intercom"]);
    // The link is traversable: a write through it lands in the store.
    writeFileSync(join(checkout, ".tmp", "intercom", "probe.txt"), "via-link\n");
    expect(readFileSync(join(storeDir, "probe.txt"), "utf8")).toBe("via-link\n");
  });

  it("refuses a wrong-target link and a real directory", () => {
    const { storeDir } = ensureStore(identity(), "jsonl");
    const other = mkdtempSync(join(scratchRoot(), "giwt-intercom-other-"));
    tempRoots.push(other);
    mkdirSync(join(checkout, ".tmp"), { recursive: true });
    symlinkSync(other, join(checkout, ".tmp", "intercom"));
    expect(() => ensureLink(checkout, storeDir)).toThrow(/symlink to .* — expected/);
    expect(readlinkSync(join(checkout, ".tmp", "intercom"))).toBe(other); // untouched
    rmSync(join(checkout, ".tmp", "intercom"));
    mkdirSync(join(checkout, ".tmp", "intercom"), { recursive: true });
    expect(() => ensureLink(checkout, storeDir)).toThrow(/real directory/);
  });

  it("repairs a dangling link and reports the state", () => {
    const { storeDir } = ensureStore(identity(), "jsonl");
    const dead = join(stateDir, "dead-store");
    mkdirSync(join(checkout, ".tmp"), { recursive: true });
    symlinkSync(dead, join(checkout, ".tmp", "intercom"));
    expect(linkStatus(checkout, storeDir)).toEqual({ state: "dangling", current: dead });
    ensureLink(checkout, storeDir);
    expect(readlinkSync(join(checkout, ".tmp", "intercom"))).toBe(storeDir);
  });
});

describe("resolveExistingStore", () => {
  it("throws with a remedy before init and resolves after", () => {
    expect(() => resolveExistingStore(checkout)).toThrow(/run 'giwt intercom init' first/);
    ensureStore(identity(), "jsonl");
    const resolved = resolveExistingStore(checkout);
    expect(resolved.storeDir).toBe(storeDirFor(identity()));
    expect(resolved.meta?.backend).toBe("jsonl");
  });
});
