// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHeader,
  checkHeader,
  commentStyleFor,
  generatedHeader,
  headerRegion,
  parseLicenses,
  parseReuseToml,
  type ReuseRule,
  selectRule,
} from "./reuse-toml";

describe("parseReuseToml", () => {
  test("parses [[annotations]] blocks", () => {
    const toml = `[[annotations]]
paths = ["src/**", "docs/**"]
license = "AGPL-3.0-or-later"
copyright = "2026 giwt Contributors"

[[annotations]]
paths = ["scripts/**"]
license = "MIT"
copyright = "2026 giwt Contributors"
`;
    const rules = parseReuseToml(toml);
    expect(rules.length).toBe(2);
    expect(rules[0]!.paths).toEqual(["src/**", "docs/**"]);
    expect(rules[0]!.license).toBe("AGPL-3.0-or-later");
    expect(rules[0]!.copyright).toBe("2026 giwt Contributors");
    expect(rules[0]!.matchers.length).toBe(2);
    expect(rules[1]!.license).toBe("MIT");
  });

  test("handles precedence field", () => {
    const toml = `[[annotations]]
paths = ["src/**"]
license = "MIT"
copyright = "2026 giwt Contributors"
precedence = "override"
`;
    const rules = parseReuseToml(toml);
    expect(rules[0]!.precedence).toBe("override");
  });

  test("skips blocks without paths", () => {
    const toml = `[[annotations]]
license = "MIT"
copyright = "2026 giwt Contributors"
`;
    expect(parseReuseToml(toml).length).toBe(0);
  });

  test("globToRegex handles ** and *", () => {
    const toml = `[[annotations]]
paths = ["src/**", "docs/*.md"]
license = "MIT"
copyright = "2026 giwt Contributors"
`;
    const rules = parseReuseToml(toml);
    expect(rules[0]!.matchers[0]!.test("src/foo/bar.ts")).toBe(true);
    expect(rules[0]!.matchers[0]!.test("docs/readme.md")).toBe(false);
    expect(rules[0]!.matchers[1]!.test("docs/readme.md")).toBe(true);
    expect(rules[0]!.matchers[1]!.test("docs/sub/readme.md")).toBe(false);
  });

  test("parses REUSE spec keys (path / SPDX-*)", () => {
    const toml = `[[annotations]]
path = ["src/**"]
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 Acme Corp"
`;
    const rules = parseReuseToml(toml);
    expect(rules.length).toBe(1);
    expect(rules[0]!.paths).toEqual(["src/**"]);
    expect(rules[0]!.license).toBe("MIT");
    expect(rules[0]!.copyright).toBe("2026 Acme Corp");
    expect(rules[0]!.matchers[0]!.test("src/a.ts")).toBe(true);
  });

  test("parses REUSE spec scalar path", () => {
    const toml = `[[annotations]]
path = "docs/**"
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 Acme Corp"
`;
    const rules = parseReuseToml(toml);
    expect(rules[0]!.paths).toEqual(["docs/**"]);
  });

  test("parses single-quoted TOML values (license, copyright, path)", () => {
    const toml = `[[annotations]]
path = 'docs/**'
SPDX-License-Identifier = 'MIT'
SPDX-FileCopyrightText = '2026 Acme Corp'
`;
    const rules = parseReuseToml(toml);
    expect(rules[0]!.paths).toEqual(["docs/**"]);
    expect(rules[0]!.license).toBe("MIT");
    expect(rules[0]!.copyright).toBe("2026 Acme Corp");
  });

  test("parses a multi-line path array", () => {
    const toml = `[[annotations]]
path = [
  "src/**",
  "docs/**/*.md",
]
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 Acme Corp"
`;
    const rules = parseReuseToml(toml);
    expect(rules[0]!.paths).toEqual(["src/**", "docs/**/*.md"]);
  });
});

describe("parseLicenses", () => {
  test("splits OR expressions", () => {
    expect(parseLicenses("Apache-2.0 OR MIT")).toEqual(["Apache-2.0", "MIT"]);
  });

  test("single license", () => {
    expect(parseLicenses("MIT")).toEqual(["MIT"]);
  });
});

describe("checkHeader", () => {
  const rule = {
    paths: ["src/**"],
    license: "AGPL-3.0-or-later",
    copyright: "2026 giwt Contributors",
    matchers: [/^src\/.*$/],
    precedence: "aggregate",
  };

  test("valid header passes", () => {
    const content = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
export const x = 1;
`;
    const result = checkHeader(content, rule);
    expect(result.valid).toBe(true);
  });

  test("wrong license fails", () => {
    const content = `// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 giwt Contributors
export const x = 1;
`;
    const result = checkHeader(content, rule);
    expect(result.valid).toBe(false);
  });

  test("missing copyright fails", () => {
    const content = `// SPDX-License-Identifier: AGPL-3.0-or-later
export const x = 1;
`;
    const result = checkHeader(content, rule);
    expect(result.valid).toBe(false);
  });

  test("slash comment parses with the default style", () => {
    const content =
      "// SPDX-License-Identifier: AGPL-3.0-or-later\n// SPDX-FileCopyrightText: 2026 giwt Contributors\n";
    expect(checkHeader(content, rule, ".ts").valid).toBe(true);
  });

  test("hash comment parses for yml", () => {
    const content =
      "# SPDX-License-Identifier: AGPL-3.0-or-later\n# SPDX-FileCopyrightText: 2026 giwt Contributors\n";
    const result = checkHeader(content, rule, ".yml");
    expect(result.valid).toBe(true);
    expect(result.license).toBe("AGPL-3.0-or-later");
  });

  test("html comment suffix is stripped from both tokens", () => {
    const content =
      "<!-- SPDX-License-Identifier: AGPL-3.0-or-later-->\n<!-- SPDX-FileCopyrightText: 2026 giwt Contributors-->\n";
    const result = checkHeader(content, rule, ".md");
    expect(result.valid).toBe(true);
    expect(result.license).toBe("AGPL-3.0-or-later");
    expect(result.copyright).toBe("2026 giwt Contributors");
  });

  test("spaced html suffix is stripped too (epics-index.md shape)", () => {
    const content =
      "<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->\n";
    const result = checkHeader(content, rule, ".md");
    expect(result.valid).toBe(true);
    expect(result.license).toBe("AGPL-3.0-or-later");
  });

  test("css block comment strips only the actual closing delimiter", () => {
    const content =
      "/* SPDX-License-Identifier: AGPL-3.0-or-later\n * SPDX-FileCopyrightText: 2026 giwt Contributors */\n";
    const result = checkHeader(content, rule, ".css");
    expect(result.valid).toBe(true);
    expect(result.license).toBe("AGPL-3.0-or-later");
    expect(result.copyright).toBe("2026 giwt Contributors");
  });

  test("a license id legitimately ending in dashes is not mangled", () => {
    const content =
      "// SPDX-License-Identifier: MIT--\n// SPDX-FileCopyrightText: 2026 giwt Contributors\n";
    const result = checkHeader(content, rule, ".md");
    expect(result.license).toBe("MIT--");
    expect(result.valid).toBe(false);
  });
});

describe("commentStyleFor", () => {
  test("hash comments for yml/yaml/toml", () => {
    expect(commentStyleFor(".yml")).toEqual({ prefix: "#", suffix: "" });
    expect(commentStyleFor(".yaml")).toEqual({ prefix: "#", suffix: "" });
    expect(commentStyleFor(".toml")).toEqual({ prefix: "#", suffix: "" });
  });
});

describe("buildHeader", () => {
  const rule = {
    paths: ["src/**"],
    license: "MIT",
    copyright: "2026 Acme Corp",
    matchers: [/^src\/.*$/],
    precedence: "aggregate",
  };

  test("markdown uses HTML comment", () => {
    expect(buildHeader(rule, ".md")).toBe(
      "<!-- SPDX-License-Identifier: MIT-->\n<!-- SPDX-FileCopyrightText: 2026 Acme Corp-->\n",
    );
  });

  test("yaml uses hash comment", () => {
    expect(buildHeader(rule, ".yaml")).toBe(
      "# SPDX-License-Identifier: MIT\n# SPDX-FileCopyrightText: 2026 Acme Corp\n",
    );
  });
});

describe("generatedHeader", () => {
  function withFixture(toml: string, run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "reuse-gen-"));
    try {
      writeFileSync(join(dir, "REUSE.toml"), toml);
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("returns the consumer's header for a matching path", () => {
    withFixture(
      `[[annotations]]
path = ["plans/**"]
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 Acme Corp"
`,
      (dir) => {
        expect(generatedHeader(join(dir, "plans", "matrix.md"), ".md")).toBe(
          "<!-- SPDX-License-Identifier: MIT-->\n<!-- SPDX-FileCopyrightText: 2026 Acme Corp-->\n",
        );
      },
    );
  });

  test("returns empty for a non-matching path", () => {
    withFixture(
      `[[annotations]]
path = ["plans/**"]
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 Acme Corp"
`,
      (dir) => {
        expect(generatedHeader(join(dir, "other", "x.md"), ".md")).toBe("");
      },
    );
  });

  test("returns empty when no REUSE.toml exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "reuse-none-"));
    try {
      expect(generatedHeader(join(dir, "plans", "x.md"), ".md")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns empty when the rule lacks copyright", () => {
    withFixture(
      `[[annotations]]
path = ["plans/**"]
SPDX-License-Identifier = "MIT"
`,
      (dir) => {
        expect(generatedHeader(join(dir, "plans", "x.md"), ".md")).toBe("");
      },
    );
  });

  test("nearest REUSE.toml wins", () => {
    const root = mkdtempSync(join(tmpdir(), "reuse-nested-"));
    try {
      writeFileSync(
        join(root, "REUSE.toml"),
        `[[annotations]]
path = ["**"]
SPDX-License-Identifier = "Apache-2.0"
SPDX-FileCopyrightText = "2026 Root Corp"
`,
      );
      const sub = join(root, "plans");
      mkdirSync(sub, { recursive: true });
      writeFileSync(
        join(sub, "REUSE.toml"),
        `[[annotations]]
path = ["**"]
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 Sub Corp"
`,
      );
      expect(generatedHeader(join(sub, "matrix.md"), ".md")).toBe(
        "<!-- SPDX-License-Identifier: MIT-->\n<!-- SPDX-FileCopyrightText: 2026 Sub Corp-->\n",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("override rule beats aggregate when both match (Option A decision)", () => {
    withFixture(
      `[[annotations]]
path = ["plans/**"]
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 Aggregate Corp"

[[annotations]]
path = ["plans/**"]
SPDX-License-Identifier = "Apache-2.0"
SPDX-FileCopyrightText = "2026 Override Corp"
precedence = "override"
`,
      (dir) => {
        expect(generatedHeader(join(dir, "plans", "x.md"), ".md")).toBe(
          "<!-- SPDX-License-Identifier: Apache-2.0-->\n<!-- SPDX-FileCopyrightText: 2026 Override Corp-->\n",
        );
      },
    );
  });

  test("last override wins among multiple overrides", () => {
    withFixture(
      `[[annotations]]
path = ["plans/**"]
SPDX-License-Identifier = "MIT"
SPDX-FileCopyrightText = "2026 A"
precedence = "override"

[[annotations]]
path = ["plans/**"]
SPDX-License-Identifier = "Apache-2.0"
SPDX-FileCopyrightText = "2026 B"
precedence = "override"
`,
      (dir) => {
        expect(generatedHeader(join(dir, "plans", "x.md"), ".md")).toContain("Apache-2.0");
      },
    );
  });
});

describe("selectRule", () => {
  const aggregate: ReuseRule = {
    paths: ["src/**"],
    license: "MIT",
    copyright: "2026 A",
    matchers: [/^src\/.*$/],
    precedence: "aggregate",
  };
  const override: ReuseRule = {
    paths: ["src/special/**"],
    license: "Apache-2.0",
    copyright: "2026 B",
    matchers: [/^src\/special\/.*$/],
    precedence: "override",
  };

  test("override beats aggregate when both match", () => {
    expect(selectRule([aggregate, override], "src/special/x.ts")).toBe(override);
  });

  test("first match wins with no overrides", () => {
    expect(selectRule([aggregate], "src/x.ts")).toBe(aggregate);
  });

  test("returns undefined when nothing matches", () => {
    expect(selectRule([aggregate], "docs/x.md")).toBeUndefined();
  });
});

describe("headerRegion / header-anchored checkHeader", () => {
  const rule = {
    paths: ["**"],
    license: "AGPL-3.0-or-later",
    copyright: "2026 giwt Contributors",
    matchers: [/.*/],
    precedence: "aggregate",
  };

  const HEADER =
    "// SPDX-License-Identifier: AGPL-3.0-or-later\n// SPDX-FileCopyrightText: 2026 giwt Contributors\n";

  test("token buried in the body is not a header", () => {
    const body = `export const x = 1;\n\n`.repeat(15)
      + "// mentioned in a comment: SPDX-License-Identifier: AGPL-3.0-or-later\n";
    expect(checkHeader(body, rule, ".ts").valid).toBe(false);
  });

  test("tokens in the header region still pass", () => {
    expect(checkHeader(`${HEADER}export const x = 1;\n`, rule, ".ts").valid).toBe(true);
  });

  test("shebang is skipped before the header region", () => {
    const content = `#!/usr/bin/env bun\n${HEADER}export const x = 1;\n`;
    expect(checkHeader(content, rule, ".ts").valid).toBe(true);
  });

  test("YAML frontmatter is skipped before the header region", () => {
    const content = `---\ntitle: doc\n---\n${HEADER}# doc\n`;
    expect(checkHeader(content, rule, ".md").valid).toBe(true);
  });

  test("token just past the region boundary does not validate", () => {
    const filler = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const content = filler + HEADER;
    expect(headerRegion(content).includes("SPDX-License-Identifier")).toBe(false);
    expect(checkHeader(content, rule, ".ts").valid).toBe(false);
  });
});
