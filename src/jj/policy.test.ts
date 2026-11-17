// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
/**
 * Resource contract: pure classifier calls only — no filesystem, env, ports,
 * process state, or module globals. Each case owns only its local argv array;
 * order-independent and safe under the parallel test runner.
 */

import { describe, expect, test } from "bun:test";
import { classifyJj, classifyJjInvocation } from "./policy";
import { JJ_BLOCK, JJ_BYPASS_TOKENS } from "./policy-tables";

const v = (a: string[]) => classifyJjInvocation(a).verdict;

describe("classifyJjInvocation", () => {
  test("RO and RW verbs pass", () => {
    for (
      const a of [
        ["status"],
        ["log", "-r", "@"],
        ["op", "log"],
        ["file", "list"],
        ["git", "colocation", "status"],
        ["config", "list"],
        ["--config=colors=never", "status"],
        ["-R", "/tmp/repo", "status"],
        ["version"],
        ["new"],
        ["commit", "-m", "x"],
        ["rebase", "-r", "@", "--onto", "main"],
        ["git", "push"],
        ["undo"],
        ["run", "--", "true"],
        ["--", "status"],
      ]
    ) {
      expect(v(a), a.join(" ")).toBe("pass");
    }
  });

  test("BLOCK families are refused, including git colocation rebinds", () => {
    for (const key of Object.keys(JJ_BLOCK)) expect(v(key.split(" ")), key).toBe("block");
    expect(v(["git", "colocation", "enable"])).toBe("block");
    expect(v(["op", "abandon"])).toBe("block");
  });

  test("bypass tokens are refused anywhere, including behind -R", () => {
    for (const t of JJ_BYPASS_TOKENS) {
      expect(v(["status", t]), t).toBe("block");
      expect(v([`${t}=x`, "status"]), t).toBe("block");
    }
    expect(v(["-R", "--ignore-immutable", "status"])).toBe("block");
  });

  test("signing, identity and code-exec config keys are refused", () => {
    for (
      const k of [
        "user.name",
        "user.email",
        "signing.behavior",
        "signing.backend",
        "revset-aliases.immutable_heads()",
        "fix.tools.x.command",
        "merge-tools.x",
        "ui.editor",
      ]
    ) {
      expect(v(["--config", `${k}=evil`, "status"]), k).toBe("block");
    }
    expect(v(["--config=user.name=evil", "status"])).toBe("block");
    expect(v(["status", "--config-file", "/tmp/x"])).toBe("block");
    expect(v(["--config-file=/tmp/x", "status"])).toBe("block");
  });

  test("lists are opt-in and never lift BLOCK; empty argv is blocked", () => {
    expect(v(["bogusverb"])).toBe("block");
    expect(
      classifyJjInvocation(["bogusverb"], { safe: [], allow: ["bogusverb"], deny: [] }).verdict,
    ).toBe("pass");
    expect(classifyJjInvocation(["status"], { safe: [], allow: [], deny: ["status"] }).verdict)
      .toBe("block");
    expect(classifyJjInvocation(["util", "gc"], { safe: [], allow: ["util gc"], deny: [] }).verdict)
      .toBe("block");
    expect(v([])).toBe("block");
    expect(v(["--config", "colors=never"])).toBe("block");
    expect(classifyJj({ args: ["status"] }).verdict).toBe("pass");
  });
});
