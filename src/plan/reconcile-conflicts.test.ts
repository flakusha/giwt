// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isolatedGitEnv } from "../utils/git";
import { scratchRoot } from "../utils/scratch-tmp";
import {
  isAncestorOf,
  mergeIndexRecords,
  rebaseWithPlanReconciliation,
} from "./reconcile-conflicts";
import { mergeTicketHeader } from "./reconcile-conflicts/ticket-headers";

// ── ticket-header rule merge (FEAT-ticket-header-conflict-resolver) ──

const OURS_MD = `# BUG: sample ticket

**Status:** In Progress
**Priority:** high
**Tags:** stash, finalize

Body of the ours side.
`;

const THEIRS_DONE = `# BUG: sample ticket

**Status:** Done
**Priority:** high
**Tags:** finalize, plan

Body of the theirs side.
`;

describe("mergeTicketHeader", () => {
  test("done wins regardless of side", () => {
    const merged = mergeTicketHeader(OURS_MD, THEIRS_DONE, "BUG-sample.md");
    expect(merged).toContain("**Status:** Done");
    // Ours' body survives — only the header is merged.
    expect(merged).toContain("Body of the ours side.");
  });

  test("tags union keeps ours first and dedupes", () => {
    const merged = mergeTicketHeader(OURS_MD, THEIRS_DONE, "BUG-sample.md");
    expect(merged).toContain("**Tags:** stash, finalize, plan");
  });

  test("issue ref from theirs is appended when ours lacks one", () => {
    const withIssue = THEIRS_DONE.replace(
      "Body of the theirs side.",
      "Body of the theirs side.\n\n  issue: 461e906\n",
    );
    const merged = mergeTicketHeader(OURS_MD, withIssue, "BUG-sample.md");
    expect(merged).toContain("issue: 461e906");
  });

  test("non-done status keeps ours (replayed side wins, plan-vocab)", () => {
    const theirsDraft = THEIRS_DONE.replace("**Status:** Done", "**Status:** Draft");
    const merged = mergeTicketHeader(OURS_MD, theirsDraft, "BUG-sample.md");
    // Status rewrites use the plan-vocab target, same as the sync fixers.
    expect(merged).toContain("**Status:** in_progress");
  });

  test("postponed on either side does NOT close: ours (replayed side) wins", () => {
    // Regression pin: normalizeStatus('postponed') is freeform pass-through
    // (not the done bucket), so done-wins must not fire — the replayed
    // side's status stands, same as any other non-done status.
    const theirsPostponed = THEIRS_DONE.replace("**Status:** Done", "**Status:** Postponed");
    const merged = mergeTicketHeader(OURS_MD, theirsPostponed, "BUG-sample.md");
    expect(merged).toContain("**Status:** in_progress");
    expect(merged).not.toContain("**Status:** Done");
  });
});

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...isolatedGitEnv(), GIT_EDITOR: "true" },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${
        args.join(" ")
      } failed (${result.exitCode}): ${result.stderr.toString()} ${result.stdout.toString()}`,
    );
  }
  return result.stdout.toString();
}

function writeJson(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

interface Fixture {
  root: string;
  branch: string;
  cleanup: () => void;
}

/** Base-commit ticket index. `null` commits NO index at the merge base, so a
 *  two-sided add lands as an add/add conflict (git records no stage 1). */
const BASE_INDEX = {
  "TASK-ONE": { status: "open", tags: ["base"] },
  "TASK-TWO": { status: "open", tags: ["base"] },
};

function fixture(ticketsPath = ".plan/tickets", baseIndex: unknown = BASE_INDEX): Fixture {
  const root = mkdtempSync(join(scratchRoot(), "giwt-plan-reconcile-"));
  const cleanup = (): void => rmSync(root, { recursive: true, force: true });
  try {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "giwt-test@example.com");
    git(root, "config", "user.name", "giwt test");
    git(root, "config", "commit.gpgsign", "false");
    if (baseIndex !== null) writeJson(root, `${ticketsPath}/index.json`, baseIndex);
    writeFileSync(join(root, "README.md"), "fixture\n");
    if (baseIndex !== null) git(root, "add", "-f", `${ticketsPath}/index.json`);
    git(root, "add", "-f", "README.md");
    git(root, "commit", "-qm", "base");
    git(root, "checkout", "-qb", "feature");
    writeJson(root, `${ticketsPath}/index.json`, {
      "TASK-ONE": { status: "done", tags: ["base", "feature"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", `${ticketsPath}/index.json`);
    git(root, "commit", "-qm", "feature");
    git(root, "checkout", "-q", "main");
    writeJson(root, `${ticketsPath}/index.json`, {
      "TASK-ONE": { status: "closed", tags: ["base", "main"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    git(root, "add", "-f", `${ticketsPath}/index.json`);
    git(root, "commit", "-qm", "main");
    git(root, "checkout", "-q", "feature");
    return { root, branch: "feature", cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

describe("isAncestorOf", () => {
  test("true when the ancestor is already contained", () => {
    const fixtureValue = fixture();
    const { root } = fixtureValue;
    try {
      const base = git(root, "rev-parse", "main~1").trim();
      expect(isAncestorOf(root, base, "HEAD")).toBe(true);
    } finally {
      fixtureValue.cleanup();
    }
  });

  test("false for diverged refs", () => {
    const fixtureValue = fixture();
    const { root } = fixtureValue;
    try {
      expect(isAncestorOf(root, "main", "feature")).toBe(false);
    } finally {
      fixtureValue.cleanup();
    }
  });

  test("false for an unknown ref rather than claiming success", () => {
    const fixtureValue = fixture();
    const { root } = fixtureValue;
    try {
      expect(isAncestorOf(root, "no-such-branch", "HEAD")).toBe(false);
    } finally {
      fixtureValue.cleanup();
    }
  });
});

describe("mergeIndexRecords", () => {
  test("unions records and field changes", () => {
    const result = mergeIndexRecords(
      { "TASK-ONE": { status: "open" }, "TASK-TWO": { status: "open" } },
      { "TASK-ONE": { status: "done" }, "TASK-TWO": { status: "open" } },
      { "TASK-ONE": { status: "open" }, "TASK-TWO": { status: "closed" } },
    );
    expect(result.value).toEqual({
      "TASK-ONE": { status: "done" },
      "TASK-TWO": { status: "closed" },
    });
    expect(result.conflicts).toEqual([]);
  });
});

test("resolves generated conflicts across successive rebase commits", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    git(root, "checkout", "-q", "main");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "closed", tags: ["base", "main-one"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "main one");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "closed", tags: ["base", "main-one"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main-two"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "main two");
    git(root, "checkout", "-q", "feature");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature-one"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature one");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature-one"] },
      "TASK-TWO": { status: "done", tags: ["base", "feature-two"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature two");

    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([
      ".plan/tickets/index.json",
      ".plan/tickets/index.json",
      ".plan/tickets/index.json",
    ]);
    expect(git(root, "status", "--porcelain")).toBe("");
    // The merged index is committed in the final replayed commit (single
    // amend), not just staged in the worktree.
    expect(git(root, "show", "HEAD:.plan/tickets/index.json")).toContain("feature-two");
  } finally {
    fixtureValue.cleanup();
  }
});

test("takes the replayed side for non-index artifacts, then regenerates once", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, ".plan/feature-matrix.md"), "main matrix row\n");
    git(root, "add", "-f", ".plan/feature-matrix.md");
    git(root, "commit", "-qm", "main matrix");
    git(root, "checkout", "-q", "feature");
    writeFileSync(join(root, ".plan/feature-matrix.md"), "feature matrix row\n");
    git(root, "add", "-f", ".plan/feature-matrix.md");
    git(root, "commit", "-qm", "feature matrix");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature-two"] },
      "TASK-TWO": { status: "done", tags: ["base", "feature-two"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature index");

    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toContain(".plan/feature-matrix.md");
    expect(git(root, "status", "--porcelain")).toBe("");
    // The committed artifact is the regenerated projection of the merged
    // index — neither conflict side survives.
    const committed = git(root, "show", "HEAD:.plan/feature-matrix.md");
    expect(committed).not.toContain("main matrix row");
    expect(committed).not.toContain("feature matrix row");
    expect(readFileSync(join(root, ".plan/feature-matrix.md"), "utf8")).toBe(committed);
  } finally {
    fixtureValue.cleanup();
  }
});

test("stops when source files conflict with generated files", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    writeFileSync(join(root, "README.md"), "feature source\n");
    git(root, "add", "README.md");
    git(root, "commit", "-qm", "feature source");
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, "README.md"), "main source\n");
    git(root, "add", "README.md");
    git(root, "commit", "-qm", "main source");
    git(root, "checkout", "-q", "feature");
    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).not.toBe(0);
    expect(git(root, "diff", "--name-only", "--diff-filter=U")).toContain("README.md");
    expect(git(root, "status", "--porcelain")).toContain("README.md");
  } finally {
    fixtureValue.cleanup();
  }
});

test("uses configured plan and ticket paths", () => {
  const fixtureValue = fixture(".planning/issues");
  const { root } = fixtureValue;
  try {
    const result = rebaseWithPlanReconciliation(root, "main", ".planning", ".planning/issues");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([".planning/issues/index.json"]);
  } finally {
    fixtureValue.cleanup();
  }
});

test("rebase resolves generated plan conflicts and regenerates derived files", () => {
  const fixtureValue = fixture();
  const { root, branch } = fixtureValue;
  try {
    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([".plan/tickets/index.json"]);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(JSON.parse(readFileSync(join(root, ".plan/tickets/index.json"), "utf8"))).toEqual({
      "TASK-ONE": { status: "closed", tags: ["base", "main", "feature"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    expect(readFileSync(join(root, ".plan/feature-matrix.md"), "utf8")).toContain(
      "Total tickets: **2**",
    );
    expect(readFileSync(join(root, ".plan/code-map.json"), "utf8")).toBe("{}\n");
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(branch);
  } finally {
    fixtureValue.cleanup();
  }
});

test("unions both sides when the index was added on each branch (no merge-base stage)", () => {
  // Add/add: git records stages 2 and 3 only, so `git show :1:` fails and the
  // merge base contributes nothing. Both sides' tickets must survive.
  const fixtureValue = fixture(".plan/tickets", null);
  const { root } = fixtureValue;
  try {
    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    expect(result.generatedConflicts).toEqual([".plan/tickets/index.json"]);
    // Neither side's edits may be dropped by the missing base: `ours` is the
    // commit being replayed (feature), so its ticket keeps status=done while
    // main's ticket is unioned in alongside it.
    expect(JSON.parse(readFileSync(join(root, ".plan/tickets/index.json"), "utf8"))).toEqual({
      "TASK-ONE": { status: "closed", tags: ["base", "main", "feature"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    fixtureValue.cleanup();
  }
});

test("names the field when all three index stages disagree on it", () => {
  // base=open, ours=done, theirs=closed: no pair matches the base, so the
  // field cannot be auto-merged and must be reported by name.
  const result = mergeIndexRecords(
    { "TASK-ONE": { status: "open" }, "TASK-TWO": { status: "open" } },
    { "TASK-ONE": { status: "done" }, "TASK-TWO": { status: "open" } },
    { "TASK-ONE": { status: "closed" }, "TASK-TWO": { status: "open" } },
  );
  expect(result.conflicts).toEqual(["index.TASK-ONE.status"]);
  // Uncontested fields on the same ticket still merge.
  expect(result.value).toEqual({
    "TASK-ONE": { status: "done" },
    "TASK-TWO": { status: "open" },
  });
});

test("regenerates the epic docs when a generated conflict is resolved", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    // Rewind feature to the merge base and re-stack its commits, so the epics
    // dir is in the worktree by the time the index conflict is resolved (the
    // epics docs are generated from what regenerate() can see on disk).
    git(root, "reset", "--hard", git(root, "rev-parse", "main~1").trim());
    const epic = [
      "# EPIC: Alpha",
      "",
      "**Status:** in-progress",
      "**Priority:** high",
      "**Effort:** 3",
      "**Type:** feature",
      "**Tags:** core, alpha",
      "",
      "## Overview",
      "",
      "The alpha epic body.",
      "",
      "- [ ] TASK-ONE work",
      "",
    ].join("\n");
    mkdirSync(join(root, ".plan/epics"), { recursive: true });
    writeFileSync(join(root, ".plan/epics/epic-alpha.md"), epic);
    git(root, "add", "-f", ".plan/epics/epic-alpha.md");
    git(root, "commit", "-qm", "add epic");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature index");

    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).toBe(0);
    // genDocs runs on the regeneration path: the epics index must carry the
    // epic's parsed metadata out of the source tree, not just its filename.
    const index = readFileSync(join(root, ".plan/epics-index.md"), "utf8");
    expect(index).toContain("**Total:** 1 epics");
    expect(index).toContain("| in-progress | Alpha | high | 3 | 1 |");
    expect(index).toContain("**Tags:** core, alpha");
    expect(git(root, "status", "--porcelain")).toBe("");
    // The regeneration is folded into the final replayed commit (single
    // amend), not left staged or dropped.
    expect(git(root, "show", "HEAD:.plan/epics-index.md")).toBe(index);
  } finally {
    fixtureValue.cleanup();
  }
});

test("does not auto-resolve when a source file conflicts alongside a generated one", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  try {
    // ONE commit per side that touches both a generated and a human file. The
    // rewind makes this the FIRST commit the rebase replays, so the very first
    // conflict set spans a human file and a generated one together — a human
    // must resolve, and giwt must not clobber the generated file.
    git(root, "reset", "--hard", git(root, "rev-parse", "main~1").trim());
    writeFileSync(join(root, "README.md"), "feature side\n");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "done", tags: ["base", "feature"] },
      "TASK-TWO": { status: "open", tags: ["base"] },
    });
    git(root, "add", "-f", "README.md", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "feature touches both");
    git(root, "checkout", "-q", "main");
    writeFileSync(join(root, "README.md"), "main side\n");
    writeJson(root, ".plan/tickets/index.json", {
      "TASK-ONE": { status: "closed", tags: ["base", "main"] },
      "TASK-TWO": { status: "closed", tags: ["base", "main"] },
    });
    git(root, "add", "-f", "README.md", ".plan/tickets/index.json");
    git(root, "commit", "-qm", "main touches both");
    git(root, "checkout", "-q", "feature");

    const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
    expect(result.exitCode).not.toBe(0);
    // Nothing was auto-resolved: both paths are still unmerged in the index.
    const unmerged = git(root, "diff", "--name-only", "--diff-filter=U");
    expect(unmerged).toContain("README.md");
    expect(unmerged).toContain(".plan/tickets/index.json");
    expect(git(root, "ls-files", "-u")).toContain(".plan/tickets/index.json");
  } finally {
    fixtureValue.cleanup();
  }
});

test("pinned sign flags reach the reconcile amend commit (BUG-reconcile-conflicts GPG)", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  // Stub gpg on PATH: appends its argv to a marker file so the test proves
  // git actually attempted signing AND that the pinned key reached gpg.
  const binDir = join(root, ".gpg-bin");
  const marker = join(root, ".gpg-called");
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, "gpg");
  // git's signing interface requires the signature on stdout and a
  // [GNUPG:] SIG_CREATED status line on stderr, else it fatal-fails.
  writeFileSync(
    stub,
    `#!/bin/sh\necho "$@" >> ${marker}\necho "-----BEGIN PGP SIGNATURE-----"\necho "[GNUPG:] SIG_CREATED " >&2\nexit 0\n`,
  );
  chmodSync(stub, 0o755);
  try {
    git(root, "config", "commit.gpgsign", "true");
    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath ?? ""}`;
    try {
      const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets", [
        "-c",
        "commit.gpgsign=true",
        "-c",
        "user.signingkey=TESTKEY",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.generatedConflicts.length).toBeGreaterThan(0);
    } finally {
      process.env.PATH = oldPath;
    }
    // The pinned signing key reached gpg during the amend — without the
    // flags the ambient config (no user.signingkey) signs with the default
    // identity and TESTKEY would never appear in gpg's argv.
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, "utf8")).toContain("TESTKEY");
  } finally {
    fixtureValue.cleanup();
  }
});

test("no pinned flags keeps the amend unsigned and un-probed", () => {
  const fixtureValue = fixture();
  const { root } = fixtureValue;
  const binDir = join(root, ".gpg-bin");
  const marker = join(root, ".gpg-called");
  mkdirSync(binDir, { recursive: true });
  const stub = join(binDir, "gpg");
  // git's signing interface requires the signature on stdout and a
  // [GNUPG:] SIG_CREATED status line on stderr, else it fatal-fails.
  writeFileSync(
    stub,
    `#!/bin/sh\necho "$@" >> ${marker}\necho "-----BEGIN PGP SIGNATURE-----"\necho "[GNUPG:] SIG_CREATED " >&2\nexit 0\n`,
  );
  chmodSync(stub, 0o755);
  try {
    // Fixture default: commit.gpgsign=false, and no signFlags passed.
    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath ?? ""}`;
    try {
      const result = rebaseWithPlanReconciliation(root, "main", ".plan", ".plan/tickets");
      expect(result.exitCode).toBe(0);
    } finally {
      process.env.PATH = oldPath;
    }
    expect(existsSync(marker)).toBe(false);
  } finally {
    fixtureValue.cleanup();
  }
});
