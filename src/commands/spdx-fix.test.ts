// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { setOutputFormat } from "../utils/output";
import { scratchRoot } from "../utils/scratch-tmp";
import { DEFAULT_SETTINGS } from "../utils/settings";
import { runSpdxFix } from "./spdx-fix";

let root = "";
let config: WorktreeConfig;

// Resource contract (parallel-safe): every test owns a mkdtemp fixture repo
// with its own REUSE.toml; process.stdout is spied and restored per test.
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function makeRepo(): void {
  root = mkdtempSync(join(scratchRoot(), "giwt-spdxfix-cmd-"));
  writeFileSync(
    join(root, "REUSE.toml"),
    `[[annotations]]
path = "src/**"
SPDX-License-Identifier = "AGPL-3.0-or-later"
SPDX-FileCopyrightText = "2026 Fixture Corp"
`,
  );
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "bare.ts"), "export {};\n");
  config = {
    repoRoot: root,
    worktreeRoot: root,
    treeDir: join(root, "tree"),
    settings: DEFAULT_SETTINGS,
  };
}

/** Capture stdout (the logger's raw channel) for the duration of `run`. */
async function capture(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = spyOn(process.stdout, "write").mockImplementation(
    ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as never,
  );
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

describe("runSpdxFix", () => {
  test("explicit absolute path matches the rule via its repo-relative shape", async () => {
    setOutputFormat("simple");
    makeRepo();
    const abs = join(root, "src", "bare.ts");
    const out = await capture(() => runSpdxFix([abs], config));
    const content = readFileSync(abs, "utf8");
    expect(content.startsWith("// SPDX-License-Identifier: AGPL-3.0-or-later")).toBe(true);
    expect(content).toContain("SPDX-FileCopyrightText: 2026 Fixture Corp");
    expect(out).toContain("fixed 1 file(s)");
  });

  test("repo-relative explicit path works the same way", async () => {
    setOutputFormat("simple");
    makeRepo();
    const out = await capture(() => runSpdxFix(["src/bare.ts"], config));
    const content = readFileSync(join(root, "src", "bare.ts"), "utf8");
    expect(content).toContain("SPDX-License-Identifier: AGPL-3.0-or-later");
    expect(out).toContain("fixed 1 file(s)");
  });

  test("a file matching no rule is left untouched", async () => {
    setOutputFormat("simple");
    makeRepo();
    const orphan = join(root, "docs", "note.md");
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(orphan, "# note\n");
    const out = await capture(() => runSpdxFix([orphan], config));
    expect(readFileSync(orphan, "utf8")).toBe("# note\n");
    expect(out).toContain("fixed 0 file(s)");
  });

  test("--help prints usage without touching the repo", async () => {
    setOutputFormat("simple");
    makeRepo();
    const out = await capture(() => runSpdxFix(["--help"], config));
    expect(out).toContain("Usage: giwt spdx-fix [--staged] [files...]");
    expect(out).toContain("--staged  fix only staged files");
    expect(readFileSync(join(root, "src", "bare.ts"), "utf8")).toBe("export {};\n");
  });

  test("missing REUSE.toml exits 1 with an error line", async () => {
    setOutputFormat("simple");
    root = mkdtempSync(join(scratchRoot(), "giwt-spdxfix-noreuse-"));
    config = {
      repoRoot: root,
      worktreeRoot: root,
      treeDir: join(root, "tree"),
      settings: DEFAULT_SETTINGS,
    };
    const errChunks: string[] = [];
    const errSpy = spyOn(process.stderr, "write").mockImplementation(
      ((chunk: unknown) => {
        errChunks.push(String(chunk));
        return true;
      }) as never,
    );
    const exitSpy = spyOn(process, "exit").mockImplementation(
      ((code?: number) => {
        throw new Error(`__exit:${code ?? 0}`);
      }) as never,
    );
    try {
      await expect(runSpdxFix([], config)).rejects.toThrow("__exit:1");
      expect(errChunks.join("")).toContain("REUSE.toml not found at");
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  test("REUSE.toml with no [[annotations]] blocks warns and returns", async () => {
    setOutputFormat("simple");
    makeRepo();
    writeFileSync(join(root, "REUSE.toml"), "# no annotations here\n");
    const errChunks: string[] = [];
    const errSpy = spyOn(process.stderr, "write").mockImplementation(
      ((chunk: unknown) => {
        errChunks.push(String(chunk));
        return true;
      }) as never,
    );
    try {
      await runSpdxFix([], config);
      expect(errChunks.join("")).toContain("no [[annotations]] blocks");
      expect(readFileSync(join(root, "src", "bare.ts"), "utf8")).toBe("export {};\n");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("explicit args with no checkable extension report no files to fix", async () => {
    setOutputFormat("simple");
    makeRepo();
    writeFileSync(join(root, "Makefile"), "all:\n  echo hi\n");
    const out = await capture(() => runSpdxFix(["Makefile"], config));
    expect(out).toContain("no files to fix");
  });

  test("--staged fixes only the staged files", async () => {
    setOutputFormat("simple");
    makeRepo();
    const git = (args: string[]) =>
      Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    git(["add", "REUSE.toml", "src/bare.ts"]);
    const out = await capture(() => runSpdxFix(["--staged"], config));
    expect(out).toContain("fixed 1 file(s)");
    expect(readFileSync(join(root, "src", "bare.ts"), "utf8")).toContain(
      "SPDX-License-Identifier: AGPL-3.0-or-later",
    );
  });

  test("tracked-file discovery fixes every tracked candidate", async () => {
    setOutputFormat("simple");
    makeRepo();
    const git = (args: string[]) =>
      Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    git(["init", "-q"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "t"]);
    git(["add", "REUSE.toml", "src/bare.ts"]);
    git(["commit", "-qm", "seed"]);
    const out = await capture(() => runSpdxFix([], config));
    expect(out).toContain("fixed 1 file(s)");
    expect(readFileSync(join(root, "src", "bare.ts"), "utf8")).toContain(
      "SPDX-License-Identifier: AGPL-3.0-or-later",
    );
  });
});
