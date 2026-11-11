// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `intercom` doctor check: link lifecycle findings, store drift, backend
 * mismatch, stale claims, and the missing-store severity split (note for
 * jsonl, error for pijul). Also the backendFor selection seam.
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
import { backendFor } from "../../intercom/backend";
import { projectIdentity } from "../../intercom/ids";
import { ensureStore } from "../../intercom/store";
import { isolatedGitEnv } from "../../utils/git";
import { scratchRoot } from "../../utils/scratch-tmp";
import { applicableChecks, runDoctorChecks } from "./entry.ts";
import { runIntercom } from "./intercom.ts";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let stateDir = "";
let repo = "";
const tempRoots: string[] = [];

beforeEach(() => {
  stateDir = mkdtempSync(join(scratchRoot(), "giwt-dr-intercom-state-"));
  repo = mkdtempSync(join(scratchRoot(), "giwt-dr-intercom-repo-"));
  tempRoots.push(stateDir, repo);
  execFileSync("git", ["init", "-q", repo], { env: isolatedGitEnv() });
  process.env.GIWT_INTERCOM_STATE_DIR = stateDir;
});

afterEach(() => {
  delete process.env.GIWT_INTERCOM_STATE_DIR;
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(backend: "jsonl" | "pijul" = "jsonl") {
  return runIntercom(repo, { backend, laneStaleDays: 30, worktreeRoot: repo }, NOW);
}

function rules(result: ReturnType<typeof run>): string[] {
  return result.findings.map((f) => f.rule);
}

describe("runIntercom", () => {
  it("healthy store + link: ok with a store note", () => {
    ensureStore(projectIdentity(repo), "jsonl");
    mkdirSync(join(repo, ".tmp"), { recursive: true });
    symlinkSync(
      ensureStore(projectIdentity(repo), "jsonl").storeDir,
      join(repo, ".tmp", "intercom"),
    );
    const result = run();
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.notes?.some((n) => n.startsWith("store:"))).toBe(true);
  });

  it("no link in checkout: advisory note", () => {
    ensureStore(projectIdentity(repo), "jsonl");
    const result = run();
    expect(result.ok).toBe(true);
    expect(result.notes?.some((n) => n.includes("no .tmp/intercom link"))).toBe(true);
  });

  it("dangling link: warning finding naming the remedy", () => {
    ensureStore(projectIdentity(repo), "jsonl");
    mkdirSync(join(repo, ".tmp"), { recursive: true });
    symlinkSync(join(stateDir, "vanished"), join(repo, ".tmp", "intercom"));
    const result = run();
    expect(rules(result)).toEqual(["intercom-link"]);
    expect(result.findings[0]?.severity).toBe("warning");
    expect(result.findings[0]?.message).toContain("dangling");
  });

  it("wrong-target link: warning, never re-pointed", () => {
    ensureStore(projectIdentity(repo), "jsonl");
    const other = mkdtempSync(join(scratchRoot(), "giwt-dr-intercom-other-"));
    tempRoots.push(other);
    mkdirSync(join(repo, ".tmp"), { recursive: true });
    symlinkSync(other, join(repo, ".tmp", "intercom"));
    const result = run();
    expect(rules(result)).toEqual(["intercom-link"]);
    expect(result.findings[0]?.message).toContain("wrong target");
    // The link is untouched: still pointing at the foreign dir.
    expect(lstatSync(join(repo, ".tmp", "intercom")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(repo, ".tmp", "intercom"))).toBe(other);
  });

  it("store drift: key mismatch finding", () => {
    const { storeDir } = ensureStore(projectIdentity(repo), "jsonl");
    const meta = JSON.parse(readFileSync(join(storeDir, "project.json"), "utf8")) as {
      key: string;
    };
    meta.key = "ssh://github.com/old/thing";
    writeFileSync(join(storeDir, "project.json"), JSON.stringify(meta));
    const result = run();
    expect(rules(result)).toContain("intercom-drift");
  });

  it("backend mismatch finding", () => {
    ensureStore(projectIdentity(repo), "jsonl");
    const result = runIntercom(
      repo,
      { backend: "pijul", laneStaleDays: 30, worktreeRoot: repo },
      NOW,
    );
    expect(rules(result)).toContain("intercom-backend");
  });

  it("stale active lanes: findings capped at five with an overflow note", () => {
    const { storeDir } = ensureStore(projectIdentity(repo), "jsonl");
    for (let i = 0; i < 7; i++) {
      writeFileSync(
        join(storeDir, `LANE-old-${i}.md`),
        `# LANE\nowner=a${i}\ndate=${new Date(NOW - 90 * DAY).toISOString()}\n`,
      );
    }
    const result = run();
    const stale = result.findings.filter((f) => f.rule === "intercom-stale");
    expect(stale).toHaveLength(5);
    expect(result.notes?.some((n) => n.includes("2 more stale lane(s)"))).toBe(true);
  });

  it("missing store: jsonl note vs pijul error", () => {
    const jsonl = run("jsonl");
    expect(jsonl.ok).toBe(true);
    expect(jsonl.notes?.some((n) => n.includes("no intercom store"))).toBe(true);
    const pijul = run("pijul");
    expect(pijul.ok).toBe(false);
    expect(pijul.findings[0]?.severity).toBe("error");
    expect(rules(pijul)).toEqual(["intercom-store"]);
  });

  it("clean-invariant: the check never creates the store or link", () => {
    run();
    let entries: string[] = [];
    try {
      entries = readdirSync(stateDir);
    } catch {
      /* state root not created either */
    }
    expect(entries).toEqual([]);
    expect(existsSync(join(repo, ".tmp"))).toBe(false);
  });

  it("runDoctorChecks dispatches the intercom check through the pool", async () => {
    ensureStore(projectIdentity(repo), "jsonl");
    const report = await runDoctorChecks(repo, {
      checks: ["intercom"],
      jobs: 1,
      intercom: { backend: "jsonl", laneStaleDays: 30, worktreeRoot: repo },
    });
    const check = report.checks[0]!;
    expect(check.id).toBe("intercom");
    expect(check.ok).toBe(true);
    expect(check.notes?.some((n) => n.startsWith("store:"))).toBe(true);
  });

  it("applicableChecks always includes intercom", () => {
    expect(applicableChecks(repo)).toContain("intercom");
  });
});

describe("backendFor seam", () => {
  it("returns the jsonl engine and refuses the un-wired pijul one", () => {
    expect(backendFor("jsonl").name).toBe("jsonl");
    expect(() => backendFor("pijul")).toThrow(/pijul is not wired/);
  });
});
