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
});
