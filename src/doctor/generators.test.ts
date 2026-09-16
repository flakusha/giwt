// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for doctor file generators.
 *
 * Each generator is a pure function: `(ctx: GeneratorContext) => GeneratedFile[]`.
 * Tests assert generated paths + minimal content invariants — never full file
 * equality (configs may gain keys without breaking their contract).
 */

import { describe, expect, it } from "bun:test";
import type { ProjectReport } from "./detect.ts";
import {
  generateActionlint,
  generateBiome,
  generateChangesets,
  generateCodecov,
  generateCommitlint,
  generateDependabot,
  generateDocusaurus,
  generateDprint,
  generateEditorconfig,
  generateEslint,
  generateGitignore,
  generateHappyDom,
  generateHooks,
  generateJscpd,
  generateKnip,
  generateMadge,
  generateMarkdownlint,
  generateMarkuplint,
  generateOxlint,
  generatePackageJson,
  generatePlaywright,
  generatePrettier,
  generateReleasePlease,
  generateRemark,
  generateRenovate,
  generateRuff,
  generateSemanticRelease,
  generateStylelint,
  generateTypeCoverage,
  generateTypedoc,
  generateVitepress,
  generateVitest,
} from "./generators/index.ts";
import type { GeneratorContext } from "./types.ts";

function baseReport(overrides: Partial<ProjectReport> = {}): ProjectReport {
  return {
    root: "/tmp/x",
    languages: ["typescript"],
    packageManager: "bun",
    runtimes: ["bun"],
    hasFrontend: false,
    hasBackend: false,
    hasNative: false,
    existing: {
      oxlint: false,
      biome: false,
      eslint: false,
      knip: false,
      jscpd: false,
      dprint: false,
      stylelint: false,
      markuplint: false,
      markdownlint: false,
      typeCoverage: false,
      giwt: false,
      preCommit: false,
      postCommit: false,
      prePush: false,
      husky: false,
      lefthook: false,
      linearHistory: false,
      pushProtection: false,
    },
    git: {
      isGitRepo: true,
      hasLinearHistoryConfig: false,
      hooksPath: null,
      protectedBranches: ["main"],
      agentEmail: null,
    },
    license: "unknown",
    pkgName: "x",
    pkgType: "module",
    ...overrides,
  };
}

function emptyCtx(report: ProjectReport = baseReport()): GeneratorContext {
  return { report, options: { dryRun: true } };
}

describe("generateOxlint", () => {
  it("emits .oxlintrc.json with correctness+suspicious categories", () => {
    const files = generateOxlint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".oxlintrc.json");
    expect(files[0]?.content).toContain("correctness");
    expect(files[0]?.content).toContain("suspicious");
  });
});

describe("generateBiome", () => {
  it("emits biome.json with $schema and noUnusedImports rule", () => {
    const files = generateBiome(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("biome.json");
    expect(files[0]?.content).toContain("\"$schema\"");
    expect(files[0]?.content).toContain("noUnusedImports");
  });
});

describe("generateEslint", () => {
  it("emits eslint.config.mjs (always — recommend.ts gates via configWritable)", () => {
    const files = generateEslint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("eslint.config.mjs");
    expect(files[0]?.content).toContain("tseslint");
  });
});

describe("generateKnip", () => {
  it("emits knip.json with entry/project/ignore for non-giwt package", () => {
    const files = generateKnip(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("knip.json");
    expect(files[0]?.content).toContain("entry");
    expect(files[0]?.content).toContain("project");
    expect(files[0]?.content).toContain("ignore");
  });

  it("uses src/cli.ts as entry when pkgName is giwt", () => {
    const ctx = emptyCtx(baseReport({ pkgName: "giwt" }));
    const files = generateKnip(ctx);
    expect(files[0]?.content).toContain("src/cli.ts");
  });
});

describe("generateJscpd", () => {
  it("emits .jscpd.json with threshold", () => {
    const files = generateJscpd(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".jscpd.json");
    expect(files[0]?.content).toContain("threshold");
  });
});

describe("generateDprint", () => {
  it("emits dprint.json with typescript plugin", () => {
    const files = generateDprint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("dprint.json");
    expect(files[0]?.content).toContain("typescript");
  });
});

describe("generateHooks", () => {
  it("emits 4 hook files under .githooks/ with executable=true", () => {
    const files = generateHooks(emptyCtx());
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".githooks/.install.sh",
      ".githooks/pre-commit",
      ".githooks/pre-push",
      ".githooks/prepare-commit-msg",
    ]);
    for (const f of files) {
      expect(f.executable).toBe(true);
    }
    expect(files.find((f) => f.path === ".githooks/.install.sh")?.content).toContain(
      "core.hooksPath",
    );
  });
});

describe("generatePackageJson", () => {
  it("emits package.json (merge=true) with fmt/lint/check scripts", () => {
    const files = generatePackageJson(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("package.json");
    expect(files[0]?.merge).toBe(true);
    expect(files[0]?.content).toContain("lint");
    expect(files[0]?.content).toContain("fmt");
    expect(files[0]?.content).toContain("check");
  });

  it("uses bunx commands for bun package manager", () => {
    const files = generatePackageJson(emptyCtx(baseReport({ packageManager: "bun" })));
    expect(files[0]?.content).toContain("bunx");
  });

  it("uses npx commands for npm package manager", () => {
    const files = generatePackageJson(emptyCtx(baseReport({ packageManager: "npm" })));
    expect(files[0]?.content).toContain("npx");
  });
});

describe("generateGitignore", () => {
  it("emits .gitignore including node_modules/", () => {
    const files = generateGitignore(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".gitignore");
    expect(files[0]?.content).toContain("node_modules/");
  });

  it("adds .venv/ for python projects", () => {
    const files = generateGitignore(emptyCtx(baseReport({ languages: ["python"] })));
    expect(files[0]?.content).toContain(".venv/");
  });

  it("adds target/ for rust projects", () => {
    const files = generateGitignore(emptyCtx(baseReport({ languages: ["rust"] })));
    expect(files[0]?.content).toContain("target/");
  });
});

describe("generateMarkdownlint", () => {
  it("emits .markdownlint.json", () => {
    const files = generateMarkdownlint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".markdownlint.json");
  });
});

describe("generateCommitlint", () => {
  it("emits .commitlint.yaml with conventional commit types", () => {
    const files = generateCommitlint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".commitlint.yaml");
    expect(files[0]?.content).toContain("feat");
    expect(files[0]?.content).toContain("fix");
    expect(files[0]?.content).toContain("chore");
  });
});

describe("generatePrettier", () => {
  it("emits .prettierrc.json and .prettierignore", () => {
    const files = generatePrettier(emptyCtx());
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([".prettierignore", ".prettierrc.json"]);
  });
});

describe("generateVitest", () => {
  it("emits vitest.config.ts", () => {
    const files = generateVitest(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("vitest.config.ts");
    expect(files[0]?.content).toContain("vitest/config");
  });
});

describe("generateStylelint", () => {
  it("emits .stylelintrc.json with stylelint-config-standard", () => {
    const files = generateStylelint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".stylelintrc.json");
    expect(files[0]?.content).toContain("stylelint-config-standard");
  });
});

describe("generateMarkuplint", () => {
  it("emits .markuplintrc.json extending @markuplint/html-spec", () => {
    const files = generateMarkuplint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".markuplintrc.json");
    expect(files[0]?.content).toContain("@markuplint/html-spec");
  });
});

describe("generateRemark", () => {
  it("emits remark.config.mjs with remark-lint", () => {
    const files = generateRemark(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("remark.config.mjs");
    expect(files[0]?.content).toContain("remark-lint");
  });
});

describe("generateChangesets", () => {
  it("emits .changeset/config.json and README.md", () => {
    const files = generateChangesets(emptyCtx());
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([".changeset/README.md", ".changeset/config.json"]);
  });
});

describe("generateReleasePlease", () => {
  it("emits release-please-config.json + workflow yaml", () => {
    const files = generateReleasePlease(emptyCtx());
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      ".github/workflows/release-please.yml",
      "release-please-config.json",
    ]);
  });
});

describe("generateSemanticRelease", () => {
  it("emits release.config.cjs with semantic-release plugins", () => {
    const files = generateSemanticRelease(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("release.config.cjs");
    expect(files[0]?.content).toContain("@semantic-release/commit-analyzer");
  });
});

describe("generateRenovate", () => {
  it("emits renovate.json with config:base extends", () => {
    const files = generateRenovate(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("renovate.json");
    expect(files[0]?.content).toContain("config:base");
  });
});

describe("generateDependabot", () => {
  it("emits .github/dependabot.yml with npm + github-actions ecosystems", () => {
    const files = generateDependabot(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".github/dependabot.yml");
    expect(files[0]?.content).toContain("npm");
    expect(files[0]?.content).toContain("github-actions");
  });
});

describe("generateCodecov", () => {
  it("emits codecov.yml + GH Actions workflow", () => {
    const files = generateCodecov(emptyCtx());
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([".github/workflows/codecov.yml", "codecov.yml"]);
  });
});

describe("generateTypedoc", () => {
  it("emits typedoc.json pointing to src/index.ts", () => {
    const files = generateTypedoc(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("typedoc.json");
    expect(files[0]?.content).toContain("src/index.ts");
  });
});

describe("generateVitepress", () => {
  it("emits docs/.vitepress/config.ts with title from pkgName", () => {
    const files = generateVitepress(emptyCtx(baseReport({ pkgName: "myapp" })));
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("docs/.vitepress/config.ts");
    expect(files[0]?.content).toContain("myapp");
  });
});

describe("generateDocusaurus", () => {
  it("emits docusaurus.config.ts with title from pkgName", () => {
    const files = generateDocusaurus(emptyCtx(baseReport({ pkgName: "myapp" })));
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("docusaurus.config.ts");
    expect(files[0]?.content).toContain("myapp");
  });
});

describe("generateRuff", () => {
  it("emits ruff.toml targeting py310", () => {
    const files = generateRuff(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("ruff.toml");
    expect(files[0]?.content).toContain("py310");
  });
});

describe("generateTypeCoverage", () => {
  it("emits type-coverage.json with strict + 95% global threshold", () => {
    const files = generateTypeCoverage(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("type-coverage.json");
    expect(files[0]?.content).toContain("strict");
    expect(files[0]?.content).toContain("95");
  });
});

describe("generateMadge", () => {
  it("emits madge.config.cjs detecting circular dependencies", () => {
    const files = generateMadge(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("madge.config.cjs");
    expect(files[0]?.content).toContain("circular");
  });
});

describe("generateActionlint", () => {
  it("emits .github/actionlint.yaml placeholder", () => {
    const files = generateActionlint(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".github/actionlint.yaml");
    expect(files[0]?.content).toContain("actionlint");
  });
});

describe("generateEditorconfig", () => {
  it("emits .editorconfig with root=true and utf-8", () => {
    const files = generateEditorconfig(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".editorconfig");
    expect(files[0]?.content).toContain("root = true");
    expect(files[0]?.content).toContain("utf-8");
  });
});

describe("generateHappyDom", () => {
  it("emits happy-dom.config.json with disableCSSFileLoading", () => {
    const files = generateHappyDom(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("happy-dom.config.json");
    expect(files[0]?.content).toContain("disableCSSFileLoading");
  });
});

describe("generatePlaywright", () => {
  it("emits playwright.config.ts with chromium project", () => {
    const files = generatePlaywright(emptyCtx());
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("playwright.config.ts");
    expect(files[0]?.content).toContain("chromium");
  });

  it("adds webServer block when project has backend", () => {
    const files = generatePlaywright(emptyCtx(baseReport({ hasBackend: true })));
    expect(files[0]?.content).toContain("webServer");
  });
});
