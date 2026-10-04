// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectCoAuthors,
  filterCoAuthorTrailers,
  loadAllowedTrailers,
  squashMessageWithCoAuthors,
} from "./coauthors";
import { isolatedGitEnv } from "./git";
import { scratchRoot } from "./scratch-tmp";

function git(root: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", root, ...args], {
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString();
}

function makeRepo(): string {
  const root = mkdtempSync(join(scratchRoot(), "giwt-coauthors-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "giwt-test@localhost");
  git(root, "config", "user.name", "giwt test");
  writeFileSync(join(root, "base.txt"), "base\n");
  git(root, "add", "base.txt");
  git(root, "commit", "-q", "-m", "base");
  return root;
}

describe("filterCoAuthorTrailers", () => {
  test("strips LLM-vendor trailers, keeps real co-authors", () => {
    const message = [
      "feat: thing",
      "",
      "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>",
      "Co-Authored-By: Jane Doe <jane@example.com>",
    ].join("\n");
    const result = filterCoAuthorTrailers(message, []);
    expect(result.stripped).toHaveLength(1);
    expect(result.stripped[0]).toContain("anthropic.com");
    expect(result.kept).toEqual(["Co-Authored-By: Jane Doe <jane@example.com>"]);
    expect(result.message).toContain("Jane Doe");
    expect(result.message).not.toContain("Claude");
  });

  test("ALLOWED_TRAILERS fragments override the denylist", () => {
    const message = "feat: x\n\nCo-Authored-By: Corp Bot <bot@corp.example>";
    const result = filterCoAuthorTrailers(message, ["bot@corp.example"]);
    expect(result.stripped).toHaveLength(0);
    expect(result.message).toContain("Corp Bot");
  });

  test("non-trailer text passes untouched", () => {
    const message = "feat: x\n\nBody mentioning claude in prose.\n";
    expect(filterCoAuthorTrailers(message, []).message).toBe(message);
  });
});

describe("loadAllowedTrailers", () => {
  test("parses ALLOWED_TRAILERS from .credentials.env (walk-up)", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-creds-"));
    const sub = join(root, "deep", "deeper");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(root, ".credentials.env"),
      "ALLOWED_TRAILERS=\"bot@corp.example, other@x\"\n",
    );
    try {
      expect(loadAllowedTrailers(sub)).toEqual(["bot@corp.example", "other@x"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns [] when no credentials file exists", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-nocreds-"));
    try {
      // HOME fallback may still find a real one; assert array-typed only.
      expect(Array.isArray(loadAllowedTrailers(root))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("unreadable .credentials.env degrades to []", () => {
    const root = mkdtempSync(join(scratchRoot(), "giwt-badcreds-"));
    // A DIRECTORY named .credentials.env: existsSync true, readFileSync throws.
    mkdirSync(join(root, ".credentials.env"));
    try {
      expect(loadAllowedTrailers(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("squash co-author aggregation", () => {
  test("collectCoAuthors keeps real, drops LLM, dedupes", () => {
    const root = makeRepo();
    try {
      git(root, "checkout", "-q", "-b", "feature");
      writeFileSync(join(root, "f.txt"), "work\n");
      git(root, "add", "f.txt");
      git(
        root,
        "commit",
        "-q",
        "-m",
        [
          "feat: work",
          "",
          "Co-Authored-By: Jane Doe <jane@example.com>",
          "Co-Authored-By: Claude <noreply@anthropic.com>",
        ].join("\n"),
      );
      writeFileSync(join(root, "g.txt"), "more\n");
      git(root, "add", "g.txt");
      git(root, "commit", "-q", "-m", "feat: more\n\nCo-Authored-By: Jane Doe <jane@example.com>");

      const authors = collectCoAuthors(root, "main..feature", []);
      expect(authors).toEqual(["Co-Authored-By: Jane Doe <jane@example.com>"]);

      const msg = squashMessageWithCoAuthors(root, "chore: Feature", "main..feature", []);
      expect(msg).toBe("chore: Feature\n\nCo-Authored-By: Jane Doe <jane@example.com>");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no co-authors leaves the subject unchanged", () => {
    const root = makeRepo();
    try {
      git(root, "checkout", "-q", "-b", "plain");
      writeFileSync(join(root, "p.txt"), "p\n");
      git(root, "add", "p.txt");
      git(root, "commit", "-q", "-m", "feat: plain");
      expect(squashMessageWithCoAuthors(root, "chore: Plain", "main..plain", [])).toBe(
        "chore: Plain",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
