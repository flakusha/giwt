// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
/**
 * Resource contract: pure classifier calls only — no filesystem, env, ports,
 * process state, or module globals. Each case owns only its local argv array;
 * order-independent and safe under the parallel test runner.
 */

import { describe, expect, test } from "bun:test";
import { classifyPijul, classifyPijulInvocation } from "./policy";
import { PIJUL_BLOCK } from "./policy-tables";

const v = (a: string[]) => classifyPijulInvocation(a).verdict;

describe("classifyPijulInvocation", () => {
  test("RO and RW verbs pass", () => {
    for (
      const a of [
        ["status"],
        ["log", "--oneline"],
        ["change", "ABC"],
        ["remote"],
        ["channel"],
        ["hooks", "show"],
        ["identity", "list"],
        ["--", "status"],
        ["record", "-m", "x"],
        ["squash", "-m", "x"],
        ["unrecord", "ABC"],
        ["channel", "new", "feature"],
        ["channel", "switch", "main"],
        ["remote", "delete", "origin"],
        ["identity", "new"],
        ["git", "import", "HEAD"],
      ]
    ) {
      expect(v(a), a.join(" ")).toBe("pass");
    }
  });

  test("unknown remote/channel sub-ops cannot ride the bare RO key", () => {
    expect(v(["remote", "frobnicate"])).toBe("block");
    expect(v(["channel", "frobnicate"])).toBe("block");
  });

  test("BLOCK families and unknown verbs are refused", () => {
    for (const key of Object.keys(PIJUL_BLOCK)) expect(v(key.split(" ")), key).toBe("block");
    for (const a of [["identity", "frobnicate"], ["hooks", "frobnicate"], ["bogusverb"]]) {
      expect(v(a), a.join(" ")).toBe("block");
    }
  });

  test("cert bypass tokens are refused anywhere", () => {
    for (
      const a of [["status", "-k"], ["squash", "-m", "x", "-k"], ["identity", "--no-cert-check"]]
    ) {
      expect(v(a), a.join(" ")).toBe("block");
    }
  });

  test("config keys pass before or after the verb only when allowlisted", () => {
    for (
      const a of [
        ["status", "--config", "colors=never"],
        ["status", "--config=colors=never"],
        ["--config", "colors=never", "status"],
        ["--config=colors=never", "status"],
        ["record", "-m", "x", "--config", "pager=less"],
        ["unrecord", "ABC", "--config", "unrecord_changes=true"],
      ]
    ) {
      expect(v(a), a.join(" ")).toBe("pass");
    }
    for (
      const a of [
        ["status", "--config", "bogus.key=1"],
        ["status", "--config", "author=evil"],
        ["push", "--config", "remote.origin.url=evil"],
        ["--config", "bogus.key=1", "status"],
      ]
    ) {
      expect(v(a), a.join(" ")).toBe("block");
      expect(classifyPijulInvocation(a).reason, a.join(" ")).toContain("--config");
    }
  });

  test("editor paths, identity overrides and lists are gated", () => {
    expect(classifyPijulInvocation(["record"]).reason).toContain("explicit message");
    expect(classifyPijulInvocation(["unrecord"]).reason).toContain("explicit change id");
    for (
      const a of [["record", "-m", "x", "--author=evil"], ["squash", "-m", "x", "--timestamp=1"]]
    ) {
      expect(v(a), a.join(" ")).toBe("block");
    }
    expect(v(["record", "-m", "x", "--identity", "work"])).toBe("pass");
    expect(classifyPijulInvocation(["status"], { safe: [], allow: [], deny: ["status"] }).verdict)
      .toBe("block");
    expect(classifyPijulInvocation(["bogus"], { safe: ["bogus"], allow: [], deny: [] }).verdict)
      .toBe("pass");
    expect(classifyPijulInvocation(["reset"], { safe: [], allow: ["reset"], deny: [] }).verdict)
      .toBe("block");
    expect(v([])).toBe("block");
    expect(classifyPijul({ args: ["status"] }).verdict).toBe("pass");
  });
});
