// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the shared credential loader. The module loads at import time by
 * walking up from cwd, so the in-process case chdirs into a fixture and
 * imports the module once with a query string (busts Bun's module cache —
 * each fresh instance would clobber the previous one's coverage).
 * Remaining scenarios (incomplete identity, shell output mode) run as
 * subprocesses since they need a second module instance.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCredentials } from "./credentials";

let fixture: string;
let savedCwd: string;
const repoRoot = join(import.meta.dir, "../..");

beforeEach(() => {
  savedCwd = process.cwd();
  fixture = mkdtempSync(join(tmpdir(), "giwt-credentials-"));
  process.chdir(fixture);
});

afterEach(() => {
  process.chdir(savedCwd);
  rmSync(fixture, { recursive: true, force: true });
});

/** Run the module as a script with `content` as its .credentials.env. */
function runScript(content: string): { code: number; out: string; } {
  if (content.length > 0) {
    writeFileSync(join(fixture, ".credentials.env"), content);
  }
  const proc = Bun.spawnSync(["bun", join(repoRoot, "src/utils/credentials.ts")], {
    cwd: fixture,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode ?? 1, out: proc.stdout.toString() };
}

describe("credentials loader", () => {
  it("finds .credentials.env above cwd and parses the agent identity", async () => {
    writeFileSync(
      join(fixture, ".credentials.env"),
      [
        "# agent identity",
        "",
        "MALFORMED_LINE_WITHOUT_EQUALS",
        "OTHER_KEY=ignored",
        "AGENT_GPG_KEY_ID=\"KEY123\"",
        "AGENT_GPG_NAME='Agent McAgent'",
        "AGENT_GPG_EMAIL=agent@giwt.local",
      ].join("\n"),
    );
    // Dynamic import is intentional: the module parses cwd at import time.
    // The specifier is built at runtime so TS does not resolve the
    // query-busted path (a static literal fails TS2307).
    const specifier = ["./credentials.ts", "?in-process-once"].join("");
    const mod = await import(specifier);
    const creds = mod.credentials as AgentCredentials;
    expect(creds.found).toBe(true);
    expect(creds.keyId).toBe("KEY123");
    expect(creds.name).toBe("Agent McAgent");
    expect(creds.email).toBe("agent@giwt.local");
    expect(creds.path).toBe(join(fixture, ".credentials.env"));
  });

  it("reports found=false when identity fields are incomplete", () => {
    const { out } = runScript("AGENT_GPG_KEY_ID=only-key\n");
    // No shell lines are emitted for an incomplete identity
    expect(out).toBe("");
  });

  it("falls back to an empty identity when nothing is found", () => {
    const { out } = runScript("");
    expect(out).toBe("");
  });

  it("prints shell-compatible lines when run directly", () => {
    const { code, out } = runScript(
      "AGENT_GPG_KEY_ID=K1\nAGENT_GPG_NAME=N1\nAGENT_GPG_EMAIL=E1\n",
    );
    expect(code).toBe(0);
    expect(out).toContain("AGENT_GPG_KEY_ID='K1'");
    expect(out).toContain("AGENT_GPG_NAME='N1'");
    expect(out).toContain("AGENT_GPG_EMAIL='E1'");
  });
});

describe("credentials loader edge cases (in-process module instances)", () => {
  it("stays empty and walks all the way up when no .credentials.env exists", async () => {
    // Fixture has no .credentials.env anywhere above it, so findCredentialsEnv
    // must walk past it and return null rather than a stale candidate.
    const specifier = ["./credentials.ts", "?in-process-no-env"].join("");
    const mod = await import(specifier);
    const creds = mod.credentials as AgentCredentials;
    expect(creds.found).toBe(false);
    expect(creds.keyId).toBe("");
    expect(creds.name).toBe("");
    expect(creds.email).toBe("");
    expect(creds.path).toBeUndefined();
  });

  // NOTE: bun reports coverage per module *instance*, not merged across the
  // query-busted imports in this file, so this last-loaded instance owns the
  // file's coverage rows. It deliberately combines the two remaining
  // behaviors: the upward walk landing on a parent .credentials.env, and the
  // direct-execution shell output.
  it("walks up to a parent .credentials.env and emits shell lines as the main script", async () => {
    const base = mkdtempSync(join(tmpdir(), "giwt-credentials-parent-"));
    const child = join(base, "nested", "child");
    mkdirSync(child, { recursive: true });
    writeFileSync(
      join(base, ".credentials.env"),
      "AGENT_GPG_KEY_ID=K1\nAGENT_GPG_NAME=N1\nAGENT_GPG_EMAIL=E1\n",
    );
    const prevArgv = process.argv[1];
    process.chdir(child);
    process.argv[1] = "/virtual/path/credentials.ts";
    const chunks: string[] = [];
    const spy = spyOn(process.stdout, "write").mockImplementation(
      ((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
      }) as never,
    );
    let creds: AgentCredentials | undefined;
    try {
      const specifier = ["./credentials.ts", "?in-process-parent-walk"].join("");
      const mod = await import(specifier);
      creds = mod.credentials as AgentCredentials;
    } finally {
      spy.mockRestore();
      process.argv[1] = prevArgv ?? "";
      rmSync(base, { recursive: true, force: true });
    }
    expect(creds!.found).toBe(true);
    expect(creds!.keyId).toBe("K1");
    expect(creds!.path).toBe(join(base, ".credentials.env"));
    const out = chunks.join("");
    expect(out).toContain("AGENT_GPG_KEY_ID='K1'");
    expect(out).toContain("AGENT_GPG_NAME='N1'");
    expect(out).toContain("AGENT_GPG_EMAIL='E1'");
  });
});
