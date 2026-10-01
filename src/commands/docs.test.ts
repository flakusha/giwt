// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `giwt docs` — corpus discovery, list/show/search/dump.
 *
 * Resource contract (parallel-safe): EVERY test owns a private
 * `mkdtempSync(join(tmpdir(), "giwt-docs-<slug>-"))` root, passed to the
 * handler via `config.worktreeRoot` (the handler never consults cwd), and
 * removes it in afterEach. process.exit and process.exitCode spies are
 * saved/restored per test.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WorktreeConfig } from "../utils/config";
import { docs } from "./docs";

let root = "";

afterEach(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function makeRoot(slug: string): string {
  root = mkdtempSync(join(tmpdir(), `giwt-docs-${slug}-`));
  return root;
}

function makeFile(base: string, rel: string, content: string | Uint8Array): string {
  const p = join(base, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

/** The shared fixture: top-level AGENTS.md/README.md, a nested docs/
 *  tree and a .plan tree, plus an outside-root symlink that must be
 *  skipped and a binary file that list/search must skip. */
function seedCorpus(base: string): void {
  makeFile(base, "AGENTS.md", "# Agents\nBe nice.\n");
  makeFile(base, "README.md", "giwt readme intro line\n");
  makeFile(base, "docs/guide.md", "# Guide\nthe body mentions针灸 nothing\n");
  makeFile(base, "docs/deep/nested.md", "deep nested note\n");
  makeFile(base, ".plan/tickets/index.md", "# Tickets\n");
  makeFile(base, "docs/binary.md", Buffer.from([0xff, 0xfe, 0x00, 0x01]));
}

function cfgFor(base: string): WorktreeConfig {
  return {
    repoRoot: base,
    worktreeRoot: base,
    treeDir: base,
    settings: {} as WorktreeConfig["settings"],
  };
}

interface Capture {
  out: () => string;
  err: () => string;
  restore: () => void;
}

function capture(): Capture {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const push = (chunks: string[]) => (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  const out = spyOn(process.stdout, "write").mockImplementation(push(outChunks) as never);
  const err = spyOn(process.stderr, "write").mockImplementation(push(errChunks) as never);
  return {
    out: () => outChunks.join(""),
    err: () => errChunks.join(""),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

function exitSentinel(): { codes: number[]; restore: () => void; } {
  const codes: number[] = [];
  const original = process.exit;
  process.exit = ((code?: number) => {
    codes.push(code ?? 0);
    throw new Error(`__exit:${code}`);
  }) as never;
  return {
    codes,
    restore: () => {
      process.exit = original;
    },
  };
}

describe("docs list", async () => {
  test("table lists names and titles from the whole corpus", async () => {
    const base = makeRoot("list-table");
    seedCorpus(base);
    const cap = capture();
    try {
      await docs(["list"], cfgFor(base));
      const text = cap.out();
      expect(text).toContain("AGENTS");
      expect(text).toContain("Agents");
      expect(text).toContain("README");
      // Title falls back to the first non-empty line when no heading.
      expect(text).toContain("giwt readme intro line");
      expect(text).toContain("docs/deep/nested");
      expect(text).toContain(".plan/tickets/index");
      expect(text).toContain("Tickets");
      // Binary file is skipped in list.
      expect(text).not.toContain("binary");
    } finally {
      cap.restore();
    }
  });

  test("--json parses to name/title/path records", async () => {
    const base = makeRoot("list-json");
    seedCorpus(base);
    const cap = capture();
    try {
      await docs(["list", "--json"], cfgFor(base));
      const parsed = JSON.parse(cap.out()) as Array<{
        name: string;
        title: string;
        path: string;
      }>;
      const names = parsed.map((d) => d.name);
      expect(names).toContain("AGENTS");
      expect(names).toContain("docs/guide");
      expect(names).toContain(".plan/tickets/index");
      expect(names).not.toContain("docs/binary");
      // Deterministic path sort.
      expect([...names].sort()).toEqual(names);
      const agents = parsed.find((d) => d.name === "AGENTS");
      expect(agents?.title).toBe("Agents");
      expect(agents?.path).toBe(join(base, "AGENTS.md"));
    } finally {
      cap.restore();
    }
  });

  test("missing corpus prints nothing", async () => {
    const base = makeRoot("list-empty");
    const cap = capture();
    try {
      await docs(["list"], cfgFor(base));
      expect(cap.out()).toBe("");
    } finally {
      cap.restore();
    }
  });
});

describe("docs search", async () => {
  test("hits use name:line:text format and match case-insensitively", async () => {
    const base = makeRoot("search-hit");
    makeFile(base, "AGENTS.md", "first line\nFind The Needle here\nthird\n");
    makeFile(base, ".plan/x.md", "nothing\nneedle again\n");
    const cap = capture();
    try {
      await docs(["search", "needle"], cfgFor(base));
      const text = cap.out();
      expect(text).toContain("AGENTS:2: Find The Needle here");
      expect(text).toContain(".plan/x:2: needle again");
    } finally {
      cap.restore();
    }
  });

  test("no match produces empty output", async () => {
    const base = makeRoot("search-miss");
    makeFile(base, "AGENTS.md", "nothing here\n");
    const cap = capture();
    try {
      await docs(["search", "zzz-absent"], cfgFor(base));
      expect(cap.out()).toBe("");
    } finally {
      cap.restore();
    }
  });

  test("--json emits {name,line,text} records", async () => {
    const base = makeRoot("search-json");
    makeFile(base, "AGENTS.md", "a\nneedle\n");
    const cap = capture();
    try {
      await docs(["search", "needle", "--json"], cfgFor(base));
      const parsed = JSON.parse(cap.out()) as Array<{
        name: string;
        line: number;
        text: string;
      }>;
      expect(parsed).toEqual([{ name: "AGENTS", line: 2, text: "needle" }]);
    } finally {
      cap.restore();
    }
  });

  test("missing corpus errors with 'no docs found'", async () => {
    const base = makeRoot("search-empty");
    const sentinel = exitSentinel();
    const cap = capture();
    try {
      await expect(docs(["search", "x"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
      expect(cap.err()).toContain("no docs found");
    } finally {
      cap.restore();
      sentinel.restore();
    }
  });

  test("missing term errors", async () => {
    const base = makeRoot("search-noterm");
    makeFile(base, "AGENTS.md", "x\n");
    const sentinel = exitSentinel();
    const cap = capture();
    try {
      await expect(docs(["search"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
    } finally {
      cap.restore();
      sentinel.restore();
    }
  });
});

describe("docs show", async () => {
  test("prints path header then content; names resolve case-insensitively", async () => {
    const base = makeRoot("show-basic");
    seedCorpus(base);
    const cap = capture();
    try {
      await docs(["show", ".plan/tickets/index"], cfgFor(base));
      const text = cap.out();
      expect(text).toContain(join(base, ".plan", "tickets", "index.md"));
      expect(text).toContain("# Tickets");
    } finally {
      cap.restore();
    }
    const cap2 = capture();
    try {
      await docs(["show", ".PLAN/TICKETS/INDEX"], cfgFor(base));
      expect(cap2.out()).toContain("# Tickets");
    } finally {
      cap2.restore();
    }
  });

  test("unknown name errors and names closest matches", async () => {
    const base = makeRoot("show-unknown");
    seedCorpus(base);
    const sentinel = exitSentinel();
    const cap = capture();
    try {
      await expect(docs(["show", "docs/gudie"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
      expect(cap.err()).toContain("docs/guide");
    } finally {
      cap.restore();
      sentinel.restore();
    }
  });
});

describe("docs dump", async () => {
  test("emits byte-exact content with no header", async () => {
    const base = makeRoot("dump-bytes");
    const content = "# Raw\nline two\n\nline four\n";
    makeFile(base, "docs/raw.md", content);
    const cap = capture();
    try {
      await docs(["dump", "docs/raw"], cfgFor(base));
      // raw() appends the final newline itself; payload must match exactly.
      expect(cap.out()).toBe(content);
    } finally {
      cap.restore();
    }
  });

  test("binary content errors instead of dumping", async () => {
    const base = makeRoot("dump-binary");
    makeFile(base, "docs/binary.md", Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    await expect(docs(["dump", "docs/binary"], cfgFor(base))).rejects.toThrow("not valid UTF-8");
  });

  test("unknown name errors", async () => {
    const base = makeRoot("dump-unknown");
    makeFile(base, "AGENTS.md", "x\n");
    const sentinel = exitSentinel();
    try {
      await expect(docs(["dump", "nope"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
    } finally {
      sentinel.restore();
    }
  });
});

describe("docs corpus edges", async () => {
  test("symlinks pointing outside the root are skipped", async () => {
    const base = makeRoot("symlink");
    const outside = makeRoot("symlink-outside");
    makeFile(outside, "outside.md", "outside content\n");
    mkdirSync(join(base, "docs"), { recursive: true });
    symlinkSync(join(outside, "outside.md"), join(base, "docs", "leak.md"));
    const cap = capture();
    try {
      await docs(["list"], cfgFor(base));
      expect(cap.out()).not.toContain("leak");
    } finally {
      cap.restore();
    }
  });

  test("unknown subcommand errors", async () => {
    const base = makeRoot("bad-sub");
    const sentinel = exitSentinel();
    try {
      await expect(docs(["frobnicate"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
    } finally {
      sentinel.restore();
    }
  });
});

describe("docs error paths", async () => {
  test("no args prints usage and sets exitCode 1", async () => {
    const base = makeRoot("no-args");
    const cap = capture();
    try {
      await docs([], cfgFor(base));
      expect(cap.out()).toContain("Usage: giwt docs");
      expect(process.exitCode).toBe(1);
    } finally {
      cap.restore();
      process.exitCode = 0;
    }
  });

  test("--help prints usage without setting exitCode", async () => {
    const base = makeRoot("help-flag");
    const cap = capture();
    try {
      await docs(["--help"], cfgFor(base));
      expect(cap.out()).toContain("Usage: giwt docs");
      expect(process.exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  test("docs list rejects positional args", async () => {
    const base = makeRoot("list-extra");
    makeFile(base, "AGENTS.md", "x\n");
    const sentinel = exitSentinel();
    const cap = capture();
    try {
      await expect(docs(["list", "extra"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
      expect(cap.err()).toContain("takes no positional args");
    } finally {
      sentinel.restore();
      cap.restore();
    }
  });

  test("docs show without a name errors", async () => {
    const base = makeRoot("show-missing");
    makeFile(base, "AGENTS.md", "x\n");
    const sentinel = exitSentinel();
    const cap = capture();
    try {
      await expect(docs(["show"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
      expect(cap.err()).toContain("requires exactly one <name>");
    } finally {
      sentinel.restore();
      cap.restore();
    }
  });

  test("docs dump without a name errors", async () => {
    const base = makeRoot("dump-missing");
    makeFile(base, "AGENTS.md", "x\n");
    const sentinel = exitSentinel();
    try {
      await expect(docs(["dump"], cfgFor(base))).rejects.toThrow("__exit:1");
      expect(sentinel.codes).toEqual([1]);
    } finally {
      sentinel.restore();
    }
  });

  test("docs show --json emits one JSON record with path and content", async () => {
    const base = makeRoot("show-json");
    makeFile(base, "AGENTS.md", "# Agents\nbody line\n");
    const cap = capture();
    try {
      await docs(["show", "agents", "--json"], cfgFor(base));
      const [record] = JSON.parse(cap.out()) as Array<{
        name: string;
        path: string;
        content: string;
      }>;
      expect(record?.name).toBe("AGENTS");
      expect(record?.path).toBe(join(base, "AGENTS.md"));
      expect(record?.content).toBe("# Agents\nbody line\n");
    } finally {
      cap.restore();
    }
  });

  test("search truncates at the hit cap and warns", async () => {
    const base = makeRoot("search-truncate");
    const lines = Array.from({ length: 210 }, (_, i) => `needle ${i}`);
    makeFile(base, "docs/big.md", `${lines.join("\n")}\n`);
    makeFile(base, "docs/other.md", "nothing relevant\n");
    const cap = capture();
    try {
      await docs(["search", "needle"], cfgFor(base));
      const hits = cap.out().trim().split("\n");
      expect(hits).toHaveLength(200);
      expect(hits[0]).toBe("docs/big:1: needle 0");
      expect(hits[199]).toBe("docs/big:200: needle 199");
      expect(cap.err()).toContain("truncated at 200 hits");
    } finally {
      cap.restore();
    }
  });

  test("unreadable subdirectory is skipped silently", async () => {
    const base = makeRoot("locked-sub");
    makeFile(base, "AGENTS.md", "readable\n");
    mkdirSync(join(base, "locked"), { recursive: true });
    makeFile(base, "locked/secret.md", "hidden\n");
    chmodSync(join(base, "locked"), 0o000);
    const cap = capture();
    try {
      await docs(["list"], cfgFor(base));
      expect(cap.out()).toContain("AGENTS");
      expect(cap.out()).toContain("readable");
      expect(cap.out()).not.toContain("secret");
    } finally {
      cap.restore();
      chmodSync(join(base, "locked"), 0o755);
    }
  });

  test("dangling symlink is treated as escaping", async () => {
    const base = makeRoot("dangling-link");
    makeFile(base, "AGENTS.md", "real\n");
    mkdirSync(join(base, "docs"), { recursive: true });
    symlinkSync(join(base, "docs", "gone.md"), join(base, "docs", "dangling.md"));
    const cap = capture();
    try {
      await docs(["list"], cfgFor(base));
      expect(cap.out()).not.toContain("dangling");
    } finally {
      cap.restore();
    }
  });

  test("symlinked root doc resolving inside the root is kept", async () => {
    const base = makeRoot("inside-link");
    makeFile(base, "AGENTS.md", "target content\n");
    symlinkSync(join(base, "AGENTS.md"), join(base, "README.md"));
    const cap = capture();
    try {
      await docs(["list"], cfgFor(base));
      // README resolves inside the root → not escaped → listed.
      expect(cap.out()).toContain("README");
    } finally {
      cap.restore();
    }
  });

  test("unreadable docs directory is skipped by the collector", async () => {
    const base = makeRoot("locked-docs");
    makeFile(base, "AGENTS.md", "readable\n");
    mkdirSync(join(base, "docs"), { recursive: true });
    makeFile(base, "docs/secret.md", "hidden\n");
    chmodSync(join(base, "docs"), 0o000);
    const cap = capture();
    try {
      await docs(["list"], cfgFor(base));
      expect(cap.out()).toContain("AGENTS");
      expect(cap.out()).not.toContain("secret");
    } finally {
      cap.restore();
      chmodSync(join(base, "docs"), 0o755);
    }
  });
});
