// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for the identifier-insensitive twin comparison — pure string
 * logic, no fixtures. The migration fixtures mirror the loop-lore shape
 * (two paths, byte-identical apart from the embedded migration name).
 */

import { describe, expect, it } from "bun:test";
import {
  compareTwins,
  identifierTokensFor,
  normalizeIdentifiers,
  normalizeVersionLiterals,
} from "./normalize";

const MIGRATION_A = `// Migration: 040_messages_idempotency_unique
// Creates: uq_messages_idempotency_enforced
CREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);
`;

const MIGRATION_B = `// Migration: 045_messages_idempotency_unique
// Creates: uq_messages_idempotency_enforced
CREATE UNIQUE INDEX uq_messages_idempotency_enforced ON messages(idempotency_key);
`;

describe("identifierTokensFor", () => {
  it("derives path, parent-qualified stem, basename and stem, longest first", () => {
    expect(identifierTokensFor("migrations/040_messages_unique.ts")).toEqual([
      "migrations/040_messages_unique.ts",
      "migrations/040_messages_unique",
      "040_messages_unique.ts",
      "040_messages_unique",
      "migrations",
    ]);
  });

  it("drops tokens shorter than 3 chars", () => {
    expect(identifierTokensFor("a/b.ts")).toEqual(["a/b.ts", "b.ts", "a/b"]);
  });
});

describe("compareTwins", () => {
  it("flags byte-identical texts as identical twins", () => {
    expect(
      compareTwins({
        textA: MIGRATION_A,
        pathA: "m/040_x.ts",
        textB: MIGRATION_A,
        pathB: "m/045_x.ts",
      }),
    )
      .toEqual({ twin: true, identical: true, differingTokens: [] });
  });

  it("flags the loop-lore migration pair and names both tokens", () => {
    const verdict = compareTwins({
      textA: MIGRATION_A,
      pathA: "migrations/040_messages_idempotency_unique.ts",
      textB: MIGRATION_B,
      pathB: "migrations/045_messages_idempotency_unique.ts",
    });
    expect(verdict.twin).toBe(true);
    expect(verdict.identical).toBe(false);
    expect(verdict.differingTokens).toEqual([
      "040_messages_idempotency_unique → 045_messages_idempotency_unique",
    ]);
  });

  it("accepts version-only drift with version evidence", () => {
    const verdict = compareTwins({
      textA: "export const VERSION = \"1.2.3\";\n",
      pathA: "src/one.ts",
      textB: "export const VERSION = \"1.3.0\";\n",
      pathB: "src/two.ts",
    });
    expect(verdict).toEqual({
      twin: true,
      identical: false,
      differingTokens: ["1.2.3 → 1.3.0"],
    });
  });

  it("accepts a drifted identifier owned by only one side", () => {
    // A's docblock names A's own stem; B (different path) embeds A's stem
    // region but its own — union normalization must erase both.
    const verdict = compareTwins({
      textA: "// name: alpha_module\nexport const x = 1;\n",
      pathA: "src/alpha_module.ts",
      textB: "// name: beta_module\nexport const x = 1;\n",
      pathB: "src/beta_module.ts",
    });
    expect(verdict.twin).toBe(true);
    expect(verdict.differingTokens).toEqual(["alpha_module → beta_module"]);
  });

  it("rejects genuinely different content", () => {
    expect(
      compareTwins({
        textA: MIGRATION_A,
        pathA: "migrations/040_messages_idempotency_unique.ts",
        textB: "// Migration: 045_messages_idempotency_unique\nDROP TABLE users;\n",
        pathB: "migrations/045_messages_idempotency_unique.ts",
      }).twin,
    ).toBe(false);
  });

  it("rejects different line counts", () => {
    expect(
      compareTwins({ textA: "a\n", pathA: "a/one.ts", textB: "a\nb\n", pathB: "a/two.ts" }).twin,
    ).toBe(false);
  });
});

describe("normalization primitives", () => {
  it("replaces tokens longest-first so stems never fragment paths", () => {
    expect(normalizeIdentifiers("see migrations/040_x.ts and 040_x done", [
      "migrations/040_x.ts",
      "040_x",
    ])).toBe("see \u0000ID\u0000 and \u0000ID\u0000 done");
  });

  it("erases version literals but not plain integers", () => {
    expect(normalizeVersionLiterals("v1.2.3 and 42 and 0.1.0-rc.1")).toBe(
      "\u0000VER\u0000 and 42 and \u0000VER\u0000",
    );
  });
});
