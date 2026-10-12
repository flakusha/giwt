// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReuseRule } from "./reuse-toml";
import { fixFiles } from "./spdx-fix";

const RULE: ReuseRule = {
  paths: ["src/**"],
  license: "AGPL-3.0-or-later",
  copyright: "2026 giwt Contributors",
  matchers: [/src\/.*$/],
  precedence: "aggregate",
};

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "spdx-fix-test-"));
}

describe("fixFiles", () => {
  test("adds header to file without one", async () => {
    const dir = fixture();
    try {
      const file = join(dir, "src", "foo.ts");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(file, "export const x = 1;\n");
      const fixed = await fixFiles([file], [RULE]);
      expect(fixed).toBe(1);
      const content = readFileSync(file, "utf8");
      expect(content).toContain("SPDX-License-Identifier: AGPL-3.0-or-later");
      expect(content).toContain("SPDX-FileCopyrightText: 2026 giwt Contributors");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves shebang", async () => {
    const dir = fixture();
    try {
      const file = join(dir, "src", "cli.ts");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(file, "#!/usr/bin/env bun\nconsole.log(1);\n");
      await fixFiles([file], [RULE]);
      const content = readFileSync(file, "utf8");
      expect(content.startsWith("#!/usr/bin/env bun\n")).toBe(true);
      expect(content).toContain("SPDX-License-Identifier: AGPL-3.0-or-later");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves YAML frontmatter", async () => {
    const dir = fixture();
    try {
      const file = join(dir, "src", "docs", "readme.md");
      mkdirSync(join(dir, "src", "docs"), { recursive: true });
      writeFileSync(file, "---\ntitle: Test\n---\n# Hello\n");
      await fixFiles([file], [RULE]);
      const content = readFileSync(file, "utf8");
      expect(content.startsWith("---\ntitle: Test\n---\n")).toBe(true);
      expect(content).toContain("SPDX-License-Identifier: AGPL-3.0-or-later");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips files that already have correct header", async () => {
    const dir = fixture();
    try {
      const file = join(dir, "src", "ok.ts");
      await Bun.write(
        file,
        "// SPDX-License-Identifier: AGPL-3.0-or-later\n// SPDX-FileCopyrightText: 2026 giwt Contributors\nexport const x = 1;\n",
      );
      const fixed = await fixFiles([file], [RULE]);
      expect(fixed).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips files with no matching rule", async () => {
    const dir = fixture();
    try {
      const file = join(dir, "other", "foo.ts");
      mkdirSync(join(dir, "other"), { recursive: true });
      writeFileSync(file, "export const x = 1;\n");
      const fixed = await fixFiles([file], [RULE]);
      expect(fixed).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses block comment for CSS", async () => {
    const dir = fixture();
    try {
      const file = join(dir, "src", "style.css");
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(file, "body { color: red; }\n");
      const fixed = await fixFiles([file], [RULE]);
      expect(fixed).toBe(1);
      const content = readFileSync(file, "utf8");
      expect(content).toContain("/* SPDX-License-Identifier: AGPL-3.0-or-later");
      expect(content).toContain("SPDX-FileCopyrightText: 2026 giwt Contributors");
      expect(content).toContain("*/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
