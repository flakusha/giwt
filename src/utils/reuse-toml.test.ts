// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { checkHeader, parseLicenses, parseReuseToml } from "./reuse-toml";

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
});
