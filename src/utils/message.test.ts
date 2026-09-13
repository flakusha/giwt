// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `extractMessageInput` + `validateMessage`.
 *
 * Coverage:
 *   - `-F <file>` reads the file (including trailing newline).
 *   - `-F -` reads stdin (errors on empty stdin instead of yielding "").
 *   - `-F <missing>` exits 1 with a clear message.
 *   - `-F` with no value exits 1.
 *   - Plain positional args yield `rest` and `message: null`.
 *   - Empty piped stdin with no `-F` errors instead of yielding "".
 *   - Validator accepts `feat:`, `fix(scope):`, `chore!:`, rejects
 *     uppercase, trailing period, missing colon, blank lines, no space
 *     after colon, subject > 72 chars.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractMessageInput, validateMessage } from "./message";

let tmp: string;
let origIsTTY: boolean;
let origStdinText: typeof Bun.stdin.text;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "giwt-msg-"));
  origIsTTY = process.stdin.isTTY;
  origStdinText = Bun.stdin.text;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
  Bun.stdin.text = origStdinText;
});

describe("extractMessageInput", () => {
  it("reads -F <file> and preserves newlines", async () => {
    const f = join(tmp, "msg.txt");
    writeFileSync(f, "feat(api): add /health\n\nbody line 1\nbody line 2\n");
    const r = await extractMessageInput(["-F", f, "leftover"]);
    expect(r.message).toBe("feat(api): add /health\n\nbody line 1\nbody line 2\n");
    expect(r.rest).toEqual(["leftover"]);
  });

  it("reads --message-file <file> alias", async () => {
    const f = join(tmp, "msg.txt");
    writeFileSync(f, "fix: alias");
    const r = await extractMessageInput(["--message-file", f]);
    expect(r.message).toBe("fix: alias");
  });

  it("normalises CRLF to LF when reading from a file", async () => {
    const f = join(tmp, "msg.txt");
    writeFileSync(f, "feat: x\r\n\r\nbody\r\n");
    const r = await extractMessageInput(["-F", f]);
    expect(r.message).toBe("feat: x\n\nbody\n");
  });

  it("errors when -F points to a missing file", async () => {
    const origExit = process.exit;
    const calls: number[] = [];
    process.exit = ((code: number) => {
      calls.push(code);
      throw new Error(`__exit:${code}`);
    }) as never;
    try {
      await expect(extractMessageInput(["-F", join(tmp, "nope.txt")])).rejects.toThrow("__exit:1");
      expect(calls).toEqual([1]);
    } finally {
      process.exit = origExit;
    }
  });

  it("errors when -F has no value", async () => {
    const origExit = process.exit;
    const calls: number[] = [];
    process.exit = ((code: number) => {
      calls.push(code);
      throw new Error(`__exit:${code}`);
    }) as never;
    try {
      await expect(extractMessageInput(["-F"])).rejects.toThrow("__exit:1");
    } finally {
      process.exit = origExit;
    }
  });

  it("errors when -F - reads from empty stdin", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    Bun.stdin.text = (() => Promise.resolve("")) as typeof Bun.stdin.text;
    const origExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`__exit:${code}`);
    }) as never;
    try {
      await expect(extractMessageInput(["-F", "-"])).rejects.toThrow("__exit:1");
    } finally {
      process.exit = origExit;
    }
  });

  it("errors on empty piped stdin with no -F flag", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    Bun.stdin.text = (() => Promise.resolve("   \n  ")) as typeof Bun.stdin.text;
    const origExit = process.exit;
    process.exit = ((code: number) => {
      throw new Error(`__exit:${code}`);
    }) as never;
    try {
      await expect(extractMessageInput([])).rejects.toThrow("__exit:1");
    } finally {
      process.exit = origExit;
    }
  });

  it("yields message=null when stdin is a TTY and there are no args", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    const r = await extractMessageInput(["just", "positional", "args"]);
    expect(r.message).toBeNull();
    expect(r.rest).toEqual(["just", "positional", "args"]);
  });

  it("consumes piped stdin when there are no positional args", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    Bun.stdin.text = (() => Promise.resolve("fix: from pipe\n")) as typeof Bun.stdin.text;
    const r = await extractMessageInput([]);
    expect(r.message).toBe("fix: from pipe\n");
    expect(r.rest).toEqual([]);
  });
});

describe("validateMessage", () => {
  const valid: Array<[label: string, message: string]> = [
    ["bare type", "feat: add foo"],
    ["scoped type", "fix(worktree): handle empty stdin"],
    ["breaking bang", "chore!: drop legacy"],
    ["with body", "feat(api): /health\n\nreturns 200 OK"],
  ];
  for (const [label, message] of valid) {
    it(`accepts ${label}`, () => {
      const lines = message.split("\n");
      const bodyLines = lines.length >= 2 ? lines.length - 2 : 0;
      expect(validateMessage(message)).toEqual({ ok: true, subject: lines[0] ?? "", bodyLines });
    });
  }
  const invalid: Array<[label: string, message: string, reasonFragment: string]> = [
    ["empty string", "   \n", "empty"],
    ["blank subject", "\nbody", "blank"],
    ["uppercase type", "Feat: bad", "<type>"],
    ["missing colon", "feat add foo", "<type>"],
    ["trailing period", "feat: add foo.", "period"],
    ["too long", `feat: ${"a".repeat(70)}`, "exceeds 72"],
    ["no space after colon", "feat:foo", "<type>"],
    ["subject and body not separated", "feat: x\nbody", "blank line"],
  ];
  for (const [label, message, reasonFragment] of invalid) {
    it(`rejects ${label}`, () => {
      const r = validateMessage(message);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain(reasonFragment);
    });
  }

  it("rejects null with no-input message", () => {
    const r = validateMessage(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no commit message provided");
  });

  it("strips leading BOM", () => {
    const r = validateMessage("\uFEFFfeat: hello");

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.subject).toBe("feat: hello");
  });
});
