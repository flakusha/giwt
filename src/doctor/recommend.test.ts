// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Tests for `recommend()` — pure function, no FS I/O.
 * Four scenarios: bare TS, TS+biome, non-TS, rust-only.
 * Assertions check tool ids in `add`/`skip` buckets of RecommendResult.
 */

import { describe, expect, it } from "bun:test";

import type { ExistingTooling, GitHygiene, ProjectReport } from "./detect.ts";
import { recommend } from "./recommend.ts";
import type { RecommendResult } from "./recommend.ts";

const NO_TOOLING = (): ExistingTooling => ({
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
  prettier: false,
  madge: false,
  renovate: false,
  dependabot: false,
  workflows: false,
});

const NO_GIT = (): GitHygiene => ({
  isGitRepo: false,
  hooksPath: null,
  protectedBranches: [],
  agentEmail: null,
  hasLinearHistoryConfig: false,
});

const bareTsReport = (): ProjectReport => ({
  root: "/fake/bare-ts",
  languages: ["typescript"],
  packageManager: "npm",
  runtimes: ["node"],
  hasFrontend: false,
  hasBackend: false,
  hasNative: false,
  existing: NO_TOOLING(),
  git: NO_GIT(),
  license: "unknown",
  pkgName: null,
  pkgType: null,
});

const tsWithBiomeReport = (): ProjectReport => ({
  ...bareTsReport(),
  existing: { ...NO_TOOLING(), biome: true },
});

const nonTsReport = (): ProjectReport => ({
  root: "/fake/non-ts",
  languages: ["html", "markdown"],
  packageManager: null,
  runtimes: [],
  hasFrontend: false,
  hasBackend: false,
  hasNative: false,
  existing: NO_TOOLING(),
  git: NO_GIT(),
  license: "unknown",
  pkgName: null,
  pkgType: null,
});

const rustOnlyReport = (): ProjectReport => ({
  root: "/fake/rust-only",
  languages: ["rust"],
  packageManager: null,
  runtimes: [],
  hasFrontend: false,
  hasBackend: false,
  hasNative: true,
  existing: NO_TOOLING(),
  git: NO_GIT(),
  license: "AGPL-3.0-or-later",
  pkgName: null,
  pkgType: null,
});

const idsByStatus = (
  result: RecommendResult,
  status: "add" | "skip" | "already-present",
): string[] =>
  result.recommendations
    .filter((r) => r.status === status)
    .map((r) => r.id)
    .sort();

describe("recommend()", () => {
  describe("bare TypeScript project", () => {
    const r = recommend(bareTsReport());
    const adds = idsByStatus(r, "add");
    const skips = idsByStatus(r, "skip");

    it("oxlint in add bucket (no existing config)", () => {
      expect(adds).toContain("oxlint");
    });

    it("prettier in add bucket (no formatter configured)", () => {
      expect(adds).toContain("prettier");
    });

    it("dprint in add bucket (no formatter configured)", () => {
      expect(adds).toContain("dprint");
    });

    it("eslint in skip bucket (oxlint + biome cover common rules)", () => {
      expect(skips).toContain("eslint");
    });

    it("quality tools: knip/jscpd/typeCoverage/madge in add bucket", () => {
      expect(adds).toContain("knip");
      expect(adds).toContain("jscpd");
      expect(adds).toContain("typeCoverage");
      expect(adds).toContain("madge");
    });

    it("depcheck/tsPrune in skip bucket (knip supersedes both)", () => {
      expect(skips).toContain("depcheck");
      expect(skips).toContain("tsPrune");
    });

    it("vitest in add bucket (npm runtime, not bun)", () => {
      expect(adds).toContain("vitest");
    });

    it("git-hygiene skips: husky/lefthook/postCommit/prePush/pushProtection", () => {
      for (
        const id of [
          "husky",
          "lefthook",
          "postCommit",
          "prePush",
          "pushProtection",
        ]
      ) {
        expect(skips).toContain(id);
      }
    });

    it("preCommit in add bucket (status is gated on existing only, not git repo)", () => {
      expect(adds).toContain("preCommit");
      expect(r.toWrite.find((t) => t.id === "preCommit")).toBeUndefined();
    });

    it("commitlint in add bucket", () => {
      expect(adds).toContain("commitlint");
    });

    it("gitignore/editorconfig in add bucket", () => {
      expect(adds).toContain("gitignore");
      expect(adds).toContain("editorconfig");
    });

    it("release tools: changesets/releasePlease/semanticRelease in add bucket", () => {
      expect(adds).toContain("changesets");
      expect(adds).toContain("releasePlease");
      expect(adds).toContain("semanticRelease");
    });

    it("codecov in add bucket (TS project)", () => {
      expect(adds).toContain("codecov");
    });

    it("linearHistory recommended but not writable (no git repo)", () => {
      expect(adds).toContain("linearHistory");
      expect(r.toWrite.find((t) => t.id === "linearHistory")).toBeUndefined();
    });

    it("renovate/dependabot/actionlint absent (not a git repo)", () => {
      for (const id of ["renovate", "dependabot", "actionlint"]) {
        expect(r.recommendations.find((rec) => rec.id === id)).toBeUndefined();
      }
    });

    it("toWrite only contains 'add' status entries", () => {
      for (const t of r.toWrite) {
        expect(t.status).toBe("add");
      }
    });

    it("skipped and toWrite are mutually exclusive", () => {
      const skippedIds: Record<string, true> = {};
      for (const t of r.skipped) {
        skippedIds[t.id] = true;
      }
      for (const t of r.toWrite) {
        expect(skippedIds[t.id]).toBeUndefined();
      }
    });
  });

  describe("TypeScript project with biome present", () => {
    const r = recommend(tsWithBiomeReport());

    it("biome NOT in recommendations (gated on hasFrontend which is false)", () => {
      expect(r.recommendations.find((rec) => rec.id === "biome")).toBeUndefined();
    });

    it("prettier in skip bucket (biome already formats)", () => {
      expect(idsByStatus(r, "skip")).toContain("prettier");
    });

    it("dprint in skip bucket (biome already formats)", () => {
      expect(idsByStatus(r, "skip")).toContain("dprint");
    });

    it("oxlint in add bucket (biome does not replace it)", () => {
      expect(idsByStatus(r, "add")).toContain("oxlint");
    });

    it("quality tools still in add bucket (knip/jscpd/typeCoverage/madge)", () => {
      expect(idsByStatus(r, "add")).toContain("knip");
      expect(idsByStatus(r, "add")).toContain("jscpd");
      expect(idsByStatus(r, "add")).toContain("typeCoverage");
      expect(idsByStatus(r, "add")).toContain("madge");
    });

    it("vitest still in add bucket", () => {
      expect(idsByStatus(r, "add")).toContain("vitest");
    });
  });

  describe("non-TS project (HTML + markdown, no git)", () => {
    const r = recommend(nonTsReport());
    const adds = idsByStatus(r, "add");
    const skips = idsByStatus(r, "skip");

    it("no TS-only tools in add: oxlint/eslint/prettier/dprint/biome", () => {
      for (const id of ["oxlint", "eslint", "prettier", "dprint", "biome"]) {
        expect(adds).not.toContain(id);
      }
    });

    it("markuplint in add bucket (HTML detected)", () => {
      expect(adds).toContain("markuplint");
    });

    it("markdownlint in add bucket (markdown detected)", () => {
      expect(adds).toContain("markdownlint");
    });

    it("commitlint/gitignore/editorconfig in add bucket", () => {
      expect(adds).toContain("commitlint");
      expect(adds).toContain("gitignore");
      expect(adds).toContain("editorconfig");
    });

    it("git-hygiene skips: husky/lefthook/postCommit/prePush/pushProtection", () => {
      for (
        const id of [
          "husky",
          "lefthook",
          "postCommit",
          "prePush",
          "pushProtection",
        ]
      ) {
        expect(skips).toContain(id);
      }
    });

    it("preCommit in add bucket (status is gated on existing only, not git repo)", () => {
      expect(adds).toContain("preCommit");
      expect(r.toWrite.find((t) => t.id === "preCommit")).toBeUndefined();
    });

    it("TS-only tools absent from any bucket (knip/jscpd/vitest/codecov/changesets)", () => {
      for (
        const id of [
          "knip",
          "jscpd",
          "typeCoverage",
          "vitest",
          "codecov",
          "changesets",
          "releasePlease",
          "semanticRelease",
          "typedoc",
        ]
      ) {
        expect(r.recommendations.find((rec) => rec.id === id)).toBeUndefined();
      }
    });
  });

  describe("rust-only project (no JS/TS)", () => {
    const r = recommend(rustOnlyReport());
    const adds = idsByStatus(r, "add");
    const skips = idsByStatus(r, "skip");

    it("dprint in add bucket (rust detected, no formatter)", () => {
      expect(adds).toContain("dprint");
    });

    it("no JS/TS-only tools in add: oxlint/biome/eslint/prettier/knip/jscpd/vitest", () => {
      for (
        const id of [
          "oxlint",
          "biome",
          "eslint",
          "prettier",
          "knip",
          "jscpd",
          "vitest",
          "codecov",
          "changesets",
          "releasePlease",
          "semanticRelease",
        ]
      ) {
        expect(adds).not.toContain(id);
      }
    });

    it("commitlint/gitignore/editorconfig in add bucket", () => {
      expect(adds).toContain("commitlint");
      expect(adds).toContain("gitignore");
      expect(adds).toContain("editorconfig");
    });

    it("git-hygiene skips: husky/lefthook/postCommit/prePush/pushProtection", () => {
      for (
        const id of [
          "husky",
          "lefthook",
          "postCommit",
          "prePush",
          "pushProtection",
        ]
      ) {
        expect(skips).toContain(id);
      }
    });

    it("preCommit in add bucket (status is gated on existing only, not git repo)", () => {
      expect(adds).toContain("preCommit");
      expect(r.toWrite.find((t) => t.id === "preCommit")).toBeUndefined();
    });

    it("prettier already-present when config exists", () => {
      const r2 = recommend({ ...bareTsReport(), existing: { ...NO_TOOLING(), prettier: true } });
      expect(idsByStatus(r2, "already-present")).toContain("prettier");
    });

    it("madge already-present when config exists", () => {
      const r2 = recommend({ ...bareTsReport(), existing: { ...NO_TOOLING(), madge: true } });
      expect(idsByStatus(r2, "already-present")).toContain("madge");
    });

    it("renovate/dependabot mutually exclusive: one present skips the other", () => {
      const withRenovate = recommend({
        ...bareTsReport(),
        git: { ...NO_GIT(), isGitRepo: true },
        existing: { ...NO_TOOLING(), renovate: true },
      });
      expect(idsByStatus(withRenovate, "already-present")).toContain("renovate");
      expect(idsByStatus(withRenovate, "skip")).toContain("dependabot");
      const withDependabot = recommend({
        ...bareTsReport(),
        git: { ...NO_GIT(), isGitRepo: true },
        existing: { ...NO_TOOLING(), dependabot: true },
      });
      expect(idsByStatus(withDependabot, "already-present")).toContain("dependabot");
      expect(idsByStatus(withDependabot, "skip")).toContain("renovate");
    });

    it("actionlint skipped without workflows, added with workflows (git repo)", () => {
      const noWorkflows = recommend({
        ...bareTsReport(),
        git: { ...NO_GIT(), isGitRepo: true },
      });
      expect(idsByStatus(noWorkflows, "skip")).toContain("actionlint");
      const withWorkflows = recommend({
        ...bareTsReport(),
        git: { ...NO_GIT(), isGitRepo: true },
        existing: { ...NO_TOOLING(), workflows: true },
      });
      expect(idsByStatus(withWorkflows, "add")).toContain("actionlint");
    });
  });

  describe("frontend TS project with markdown (the full-stack shape)", () => {
    const report: ProjectReport = {
      ...bareTsReport(),
      languages: ["typescript", "markdown", "html", "css"],
      hasFrontend: true,
    };
    const r = recommend(report);
    const adds = idsByStatus(r, "add");
    const skips = idsByStatus(r, "skip");

    it("biome recommended for a frontend (formatter+linter combo)", () => {
      expect(adds).toContain("biome");
    });

    it("stylelint/markuplint/markdownlint recommended for CSS/HTML/MD", () => {
      expect(adds).toContain("stylelint");
      expect(adds).toContain("markuplint");
      expect(adds).toContain("markdownlint");
    });

    it("remark recommended for a markdown-heavy frontend", () => {
      expect(adds).toContain("remark");
    });

    it("playwright/happy-dom recommended for a frontend with HTML", () => {
      expect(adds).toContain("playwright");
      expect(adds).toContain("happyDom");
    });

    it("typedoc/vitepress/docusaurus recommended for a documented frontend", () => {
      expect(adds).toContain("typedoc");
      expect(adds).toContain("vitepress");
      expect(adds).toContain("docusaurus");
    });

    it("vitepress/docusaurus not skipped while markdown is present", () => {
      expect(skips).not.toContain("vitepress");
      expect(skips).not.toContain("docusaurus");
    });
  });

  describe("frontend TS project without markdown", () => {
    const report: ProjectReport = {
      ...bareTsReport(),
      languages: ["typescript", "html", "css"],
      hasFrontend: true,
    };
    const r = recommend(report);
    const adds = idsByStatus(r, "add");
    const skips = idsByStatus(r, "skip");

    it("docs-site tools skipped (no markdown to publish)", () => {
      expect(skips).toContain("vitepress");
      expect(skips).toContain("docusaurus");
    });

    it("typedoc still added; remark absent", () => {
      expect(adds).toContain("typedoc");
      expect(r.recommendations.find((rec) => rec.id === "remark")).toBeUndefined();
    });

    it("playwright/happy-dom still added (frontend with HTML)", () => {
      expect(adds).toContain("playwright");
      expect(adds).toContain("happyDom");
    });
  });

  describe("already-present CSS/docs tooling", () => {
    it("stylelint already-present suppresses repair when config exists", () => {
      const r = recommend({
        ...bareTsReport(),
        languages: ["typescript", "css"],
        existing: { ...NO_TOOLING(), stylelint: true },
      });
      expect(idsByStatus(r, "already-present")).toContain("stylelint");
      expect(r.toWrite.find((t) => t.id === "stylelint")).toBeUndefined();
    });

    it("markuplint already-present when config exists", () => {
      const r = recommend({
        ...bareTsReport(),
        languages: ["typescript", "html"],
        existing: { ...NO_TOOLING(), markuplint: true },
      });
      expect(idsByStatus(r, "already-present")).toContain("markuplint");
    });

    it("markdownlint already-present when config exists", () => {
      const r = recommend({
        ...bareTsReport(),
        languages: ["typescript", "markdown"],
        existing: { ...NO_TOOLING(), markdownlint: true },
      });
      expect(idsByStatus(r, "already-present")).toContain("markdownlint");
    });

    it("biome already-present when config exists", () => {
      const r = recommend({
        ...bareTsReport(),
        hasFrontend: true,
        existing: { ...NO_TOOLING(), biome: true },
      });
      expect(idsByStatus(r, "already-present")).toContain("biome");
      expect(r.toWrite.find((t) => t.id === "biome")).toBeUndefined();
    });
  });

  describe("python-only project", () => {
    const report: ProjectReport = {
      root: "/fake/py",
      languages: ["python"],
      packageManager: null,
      runtimes: [],
      hasFrontend: false,
      hasBackend: false,
      hasNative: false,
      existing: NO_TOOLING(),
      git: NO_GIT(),
      license: "unknown",
      pkgName: null,
      pkgType: null,
    };
    const r = recommend(report);

    it("ruff recommended for python", () => {
      expect(idsByStatus(r, "add")).toContain("ruff");
    });

    it("no TS formatter lint tools for a python-only project", () => {
      const adds = idsByStatus(r, "add");
      for (const id of ["oxlint", "biome", "eslint", "prettier", "knip"]) {
        expect(adds).not.toContain(id);
      }
    });
  });
});
