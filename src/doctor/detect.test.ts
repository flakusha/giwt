// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for project detection (`detect.ts`).
 *
 * Coverage:
 *   - Throws on non-existent root
 *   - Bun-only TS project: typescript, bun, no frontend/backend split
 *   - Frontend+backend split detection
 *   - License SPDX from headers
 *   - Package manager inference (bun > pnpm > npm via lockfiles)
 *   - Existing tooling: oxlint/biome/knip/jscpd/markdownlint
 *   - Git hygiene: hooksPath, agentEmail, hasLinearHistoryConfig
 *   - SKIP_DIRS: node_modules/.tmp/target/.venv excluded from language count
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolatedGitEnv } from "../utils/git.ts";
import { detectProject } from "./detect.ts";

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "giwt-detect-"));
}

function write(p: string, content: string): void {
  const dir = p.split("/").slice(0, -1).join("/");
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, content);
}

describe("detectProject", () => {
  let root: string;
  beforeEach(() => {
    root = makeRepo();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("throws on non-existent root", () => {
    expect(() => detectProject("/tmp/definitely-not-a-real-path-xyz")).toThrow();
  });

  it("detects bun-only TS project", () => {
    write(join(root, "package.json"), JSON.stringify({ name: "x", type: "module" }));
    write(join(root, "bun.lock"), "");
    write(join(root, "src", "index.ts"), "export const x = 1;\n");

    const r = detectProject(root);
    expect(r.packageManager).toBe("bun");
    expect(r.languages).toContain("typescript");
    expect(r.hasFrontend).toBe(false);
    expect(r.hasBackend).toBe(false);
    expect(r.hasNative).toBe(false);
    expect(r.runtimes).toContain("bun");
    expect(r.pkgName).toBe("x");
    expect(r.pkgType).toBe("module");
  });

  it("detects frontend+backend split", () => {
    write(join(root, "package.json"), "{}");
    mkdirSync(join(root, "src", "frontend"), { recursive: true });
    mkdirSync(join(root, "src", "server"), { recursive: true });

    const r = detectProject(root);
    expect(r.hasFrontend).toBe(true);
    expect(r.hasBackend).toBe(true);
  });

  it("detects native (Cargo)", () => {
    write(join(root, "package.json"), "{}");
    write(join(root, "Cargo.toml"), "[package]\nname = \"x\"\n");
    write(join(root, "src", "lib.rs"), "pub fn x() {}\n");

    const r = detectProject(root);
    expect(r.hasNative).toBe(true);
    expect(r.languages).toContain("rust");
  });

  it("infers packageManager from lockfile precedence", () => {
    write(join(root, "package.json"), "{}");
    write(join(root, "bun.lock"), "");
    expect(detectProject(root).packageManager).toBe("bun");

    write(join(root, "pnpm-lock.yaml"), "");
    expect(detectProject(root).packageManager).toBe("bun"); // bun still wins (written first, but detection order matters)
  });

  it("infers packageManager from packageManager field", () => {
    write(
      join(root, "package.json"),
      JSON.stringify({ packageManager: "pnpm@8.0.0" }),
    );
    expect(detectProject(root).packageManager).toBe("pnpm");
  });

  it("detects existing tooling files", () => {
    write(join(root, "package.json"), "{}");
    write(join(root, ".oxlintrc.json"), "{}");
    write(join(root, "biome.json"), "{}");
    write(join(root, "knip.json"), "{}");
    write(join(root, ".jscpd.json"), "{}");
    write(join(root, ".markdownlint.json"), "{}");
    write(join(root, ".prettierrc.json"), "{}");
    write(join(root, "madge.config.cjs"), "module.exports = {};");
    write(join(root, "renovate.json"), "{}");
    write(join(root, ".github", "dependabot.yml"), "version: 2");
    write(join(root, ".github", "workflows", "ci.yml"), "name: ci");

    const r = detectProject(root);
    expect(r.existing.oxlint).toBe(true);
    expect(r.existing.biome).toBe(true);
    expect(r.existing.knip).toBe(true);
    expect(r.existing.jscpd).toBe(true);
    expect(r.existing.markdownlint).toBe(true);
    expect(r.existing.prettier).toBe(true);
    expect(r.existing.madge).toBe(true);
    expect(r.existing.renovate).toBe(true);
    expect(r.existing.dependabot).toBe(true);
    expect(r.existing.workflows).toBe(true);
  });

  it("detects SPDX license from source headers", () => {
    write(
      join(root, "src", "index.ts"),
      "// SPDX-License-Identifier: MIT\nexport const x = 1;\n",
    );
    expect(detectProject(root).license).toBe("MIT");
  });

  it("falls back to LICENSE filename heuristics", () => {
    write(
      join(root, "LICENSE"),
      "AGPL License v3 — see https://example.com\n",
    );
    expect(detectProject(root).license).toBe("AGPL-3.0-or-later");
  });

  it("skips node_modules/.tmp/target/.venv in language scan", () => {
    write(join(root, "src", "a.ts"), "export const a = 1;\n");
    write(join(root, "node_modules", "x", "index.ts"), "export const x = 1;\n");
    write(join(root, "target", "lib.rs"), "pub fn x() {}\n");
    write(join(root, ".venv", "lib", "x.py"), "x = 1\n");

    const r = detectProject(root);
    expect(r.languages).toContain("typescript");
    expect(r.languages).not.toContain("rust");
    expect(r.languages).not.toContain("python");
  });

  it("reads agentEmail from .credentials.env", () => {
    write(
      join(root, ".credentials.env"),
      "AGENT_GPG_EMAIL=agent@example.com\n",
    );
    expect(detectProject(root).git.agentEmail).toBe("agent@example.com");
  });

  it("reads protected branches from .githooks/pre-push", () => {
    mkdirSync(join(root, ".githooks"));
    write(
      join(root, ".githooks", "pre-push"),
      "#!/bin/sh\nlocal protected=\"refs/heads/(main|dev|stg|prod)$\"\n",
    );
    const r = detectProject(root);
    expect(r.git.protectedBranches).toContain("main");
    expect(r.git.protectedBranches).toContain("prod");
  });

  it("isGitRepo false when no .git", () => {
    expect(detectProject(root).git.isGitRepo).toBe(false);
  });

  it("returns sensible defaults for empty repo", () => {
    const r = detectProject(root);
    expect(r.languages).toEqual([]);
    expect(r.packageManager).toBeNull();
    expect(r.runtimes).toEqual([]);
    expect(r.license).toBe("unknown");
  });

  it("tolerates malformed package.json (no name/type, lockfile still wins)", () => {
    write(join(root, "package.json"), "{ not valid json");
    write(join(root, "yarn.lock"), "");
    const r = detectProject(root);
    expect(r.pkgName).toBeNull();
    expect(r.pkgType).toBeNull();
    expect(r.packageManager).toBe("yarn");
  });

  it("ignores an unrecognized packageManager field and falls back to lockfiles", () => {
    write(join(root, "package.json"), JSON.stringify({ packageManager: "cargo@1.0.0" }));
    write(join(root, "pnpm-lock.yaml"), "");
    expect(detectProject(root).packageManager).toBe("pnpm");
  });

  it("infers yarn and npm lockfile precedence when bun/deno/pnpm absent", () => {
    write(join(root, "package-lock.json"), "{}");
    expect(detectProject(root).packageManager).toBe("npm");
    write(join(root, "yarn.lock"), "");
    expect(detectProject(root).packageManager).toBe("yarn");
    write(join(root, "deno.lock"), "{}");
    expect(detectProject(root).packageManager).toBe("deno");
  });

  it("detects node runtime from dependencies without node_modules", () => {
    write(join(root, "package.json"), JSON.stringify({ dependencies: { left: "^1" } }));
    expect(detectProject(root).runtimes).toContain("node");
  });

  describe("git repo hygiene", () => {
    const git = (...args: string[]): void => {
      const res = Bun.spawnSync(["git", "-C", root, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: isolatedGitEnv(),
      });
      if (res.exitCode !== 0) throw new Error(res.stderr.toString());
    };

    beforeEach(() => {
      git("init", "-q", "-b", "main");
    });

    it("reports no hooksPath/linear history on a fresh repo", () => {
      const r = detectProject(root);
      expect(r.git.isGitRepo).toBe(true);
      expect(r.git.hooksPath).toBeNull();
      expect(r.git.hasLinearHistoryConfig).toBe(false);
    });

    it("reads core.hooksPath and pull.ff=only from git config", () => {
      git("config", "core.hooksPath", ".githooks");
      git("config", "pull.ff", "only");
      const r = detectProject(root);
      expect(r.git.hooksPath).toBe(".githooks");
      expect(r.git.hasLinearHistoryConfig).toBe(true);
    });

    it("treats branch.<name>.rebase=true as linear history", () => {
      git("config", "branch.main.rebase", "true");
      expect(detectProject(root).git.hasLinearHistoryConfig).toBe(true);
    });
  });

  describe("LICENSE-file license heuristics", () => {
    const cases: Array<[string, string]> = [
      ["Apache License\nVersion 2.0\n", "Apache-2.0"],
      ["MIT License\n\nPermission is hereby granted...\n", "MIT"],
      ["GNU LGPL Version 3\n", "LGPL-3.0-or-later"],
      ["All rights reserved.\n", "unknown"],
    ];
    for (const [content, expected] of cases) {
      it(`maps ${JSON.stringify(content.slice(0, 12))} to ${expected}`, () => {
        write(join(root, "LICENSE"), content);
        expect(detectProject(root).license).toBe(expected);
      });
    }

    it("prefers LICENSE.md when LICENSE is absent", () => {
      write(join(root, "LICENSE.md"), "Apache License 2.0\n");
      expect(detectProject(root).license).toBe("Apache-2.0");
    });
  });
});
