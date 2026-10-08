// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the weave damage scan — pure text fixtures reproducing the three
 * confirmed loop-lore rebase outcomes (ui.ts triplication + 17 appended
 * copies, branches.ts orphaned hint, isolate-only.ts orphaned binding) plus
 * the legitimate-repetition negatives. No git, no fs (text is passed in).
 */

import { describe, expect, it } from "bun:test";
import { scanWeaveDamage } from "./weave";
import { braceStats, codeOnly } from "./weave/braces";

const PARAM_LINE = "  onMessage: (msg: ChatMessage) => handleIncoming(msg),";

/** ui.ts as it stood: the parameter line triplicated in place, 17 more
 * copies appended after the function's closing brace. */
function uiTsDamage(appendCopies = 17): string {
  return [
    "import { ChatMessage } from \"../types\";",
    "",
    "export function registerChatHandlers(opts: HandlerOptions): void {",
    PARAM_LINE,
    PARAM_LINE,
    PARAM_LINE,
    "  opts.seal();",
    "}",
    ...Array<string>(appendCopies).fill(PARAM_LINE),
    "",
  ].join("\n");
}

describe("scanWeaveDamage — loop-lore regressions", () => {
  it("flags the triplicated parameter line plus the appended orphan block", () => {
    const findings = scanWeaveDamage({ path: "src/frontend/ui.ts", text: uiTsDamage() });
    const repeated = findings.filter((f) => f.reason === "repeated-lines");
    expect(repeated).toHaveLength(1);
    expect(repeated[0]?.severity).toBe("warning");
    expect(repeated[0]?.paths).toEqual(["src/frontend/ui.ts"]);
    const evidence = repeated[0]?.evidence ?? [];
    expect(evidence[0]?.kind).toBe("line");
    const line = evidence[0];
    if (line?.kind !== "line") throw new Error("expected line evidence");
    expect(line.content).toBe(PARAM_LINE.trim());
    expect(line.start).toBe(4);
    if (evidence[1]?.kind !== "count") throw new Error("expected count evidence");
    expect(evidence[1].detail).toContain("20 occurrences");
    expect(evidence[1].detail).toContain("4, 5, 6");

    const trailing = findings.filter((f) => f.reason === "orphaned-trailing-block");
    expect(trailing).toHaveLength(1);
    expect(trailing[0]?.severity).toBe("warning");
    expect(trailing[0]?.message).toContain("after the last top-level declaration");
  });

  it("flags the orphaned merge hint comment (branches.ts)", () => {
    const text = [
      "import { log } from \"../log\";",
      "",
      "export function branches(): string[] {",
      "  // hint: both sides added a branch here",
      "  return [\"main\", \"dev\"];",
      "}",
      "",
    ].join("\n");
    const findings = scanWeaveDamage({ path: "src/chat/service/branches.ts", text });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe("orphaned-comment-marker");
    expect(findings[0]?.severity).toBe("info");
    const line = findings[0]?.evidence[0];
    if (line?.kind !== "line") throw new Error("expected line evidence");
    expect(line.start).toBe(4);
    expect(line.content).toContain("hint:");
  });

  it("flags leftover conflict markers as critical", () => {
    const text = ["<<<<<<< HEAD", "const a = 1;", "=======", "const a = 2;", ">>>>>>> topic", ""]
      .join("\n");
    const findings = scanWeaveDamage({ path: "src/x.ts", text })
      .filter((f) => f.reason === "orphaned-comment-marker");
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === "critical")).toBe(true);
  });

  it("flags the orphaned const globals binding with no referents (isolate-only.ts)", () => {
    const text = [
      "import { rmSync } from \"node:fs\";",
      "",
      "export function isolateOnly(): void {",
      "  rmSync(\"/tmp/scratch\", { force: true });",
      "}",
      "const globals = { db: \"postgres\" };",
      "",
    ].join("\n");
    const findings = scanWeaveDamage({ path: "src/test-utils/isolate-only.ts", text });
    const binding = findings.filter((f) => f.reason === "orphaned-binding");
    expect(binding).toHaveLength(1);
    expect(binding[0]?.severity).toBe("warning");
    const token = binding[0]?.evidence.find((e) => e.kind === "token");
    if (token?.kind !== "token") throw new Error("expected token evidence");
    expect(token.detail).toBe("binding globals");
    // nothing else fires on this file
    expect(findings.filter((f) => f.reason !== "orphaned-binding")).toEqual([]);
  });
});

describe("scanWeaveDamage — negatives", () => {
  it("stays silent on legitimately repetitive code", () => {
    const text = [
      "import { a } from \"./a\";",
      "import { b } from \"./b\";",
      "import { c } from \"./c\";",
      "",
      "const TABLE = [",
      "  { id: 1, label: \"one\", flag: true },",
      "  { id: 2, label: \"two\", flag: false },",
      "  { id: 3, label: \"three\", flag: true },",
      "];",
      "",
      "export function route(n: number): string {",
      "  switch (n) {",
      "    case 1:",
      "      break;",
      "    case 2:",
      "      break;",
      "    default:",
      "      break;",
      "  }",
      "  return TABLE[n]?.label ?? \"none\";",
      "}",
      "",
    ].join("\n");
    expect(scanWeaveDamage({ path: "src/tables.ts", text })).toEqual([]);
  });

  it("truncates the occurrence list with +N more beyond 30 lines", () => {
    const line = "  handler: (msg: ChatMessage) => handleIncoming(msg),";
    const text = Array<string>(35).fill(line).join("\n");
    const findings = scanWeaveDamage({ path: "src/many.ts", text });
    const repeated = findings.filter((f) => f.reason === "repeated-lines");
    expect(repeated).toHaveLength(1);
    const count = repeated[0]?.evidence.find((e) => e.kind === "count");
    if (count?.kind !== "count") throw new Error("expected count evidence");
    expect(count.detail).toContain("35 occurrences");
    expect(count.detail).toContain("+5 more");
  });

  it("exempts a legit entry-point invocation at end of file", () => {
    const text = [
      "import { run } from \"./run\";",
      "",
      "function main(): void {",
      "  run();",
      "}",
      "",
      "  main();",
      "",
    ].join("\n");
    expect(scanWeaveDamage({ path: "src/cli-main.ts", text })).toEqual([]);
  });

  it("returns [] for unreadable files instead of throwing", () => {
    expect(scanWeaveDamage({ path: "/nonexistent/giwt-audit-probe.ts" })).toEqual([]);
  });
});

describe("scanWeaveDamage — brace balance", () => {
  it("flags unbalanced braces without a baseline", () => {
    const findings = scanWeaveDamage({ path: "src/broken.ts", text: "function f() {\n" });
    expect(findings.map((f) => f.reason)).toEqual(["brace-anomaly"]);
    expect(findings[0]?.severity).toBe("warning");
  });

  it("flags a balanced duplicated region against the pre-merge baseline", () => {
    const baseline = "function f() {\n  if (x) {\n    return 1;\n  }\n}\n";
    const ifBlock = "  if (x) {\n    return 1;\n  }\n";
    const damaged = `function f() {\n${ifBlock.repeat(5)}}\n`;
    const findings = scanWeaveDamage({ path: "src/dup.ts", text: damaged, baseline });
    expect(findings.map((f) => f.reason)).toEqual(["brace-anomaly"]);
    expect(findings[0]?.severity).toBe("info");
  });

  it("stays silent when the file matches its baseline shape", () => {
    const baseline = "function f() {\n  if (x) {\n    return 1;\n  }\n}\n";
    expect(scanWeaveDamage({ path: "src/ok.ts", text: baseline, baseline })).toEqual([]);
  });
});

describe("brace counting primitives", () => {
  it("ignores braces in strings, templates and comments", () => {
    const text = [
      "const s = \"a { b\";",
      "const t = `x ${ { deep: true } } y`;",
      "// comment { with brace",
      "/* block { also } ignored */",
      "function real() { return s.length + t.length; }",
    ].join("\n");
    expect(braceStats(text)).toEqual({ opens: 3, closes: 3, net: 0, minDepth: 0 });
    expect(codeOnly(text)).not.toContain("a { b");
  });

  it("detects negative depth from a stray closer", () => {
    expect(braceStats("}\nfunction f() {\n").minDepth).toBe(-1);
  });
});
