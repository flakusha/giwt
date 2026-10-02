// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt doctor` apply step: plan the generated files, write them
 * (with package.json merge handling), and apply git config side-effects.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateActionlint } from "../../doctor/generators/actionlint.ts";
import { generateBiome } from "../../doctor/generators/biome.ts";
import { generateCommitlint } from "../../doctor/generators/commitlint.ts";
import { generateDependabot } from "../../doctor/generators/dependabot.ts";
import { generateDprint } from "../../doctor/generators/dprint.ts";
import { generateEditorconfig } from "../../doctor/generators/editorconfig.ts";
import { generateEslint } from "../../doctor/generators/eslint.ts";
import { generateGitignore } from "../../doctor/generators/gitignore.ts";
import { generateHooks } from "../../doctor/generators/hooks.ts";
import { generateJscpd } from "../../doctor/generators/jscpd.ts";
import { generateKnip } from "../../doctor/generators/knip.ts";
import { generateLefthook } from "../../doctor/generators/lefthook.ts";
import { generateMadge } from "../../doctor/generators/madge.ts";
import { generateMarkdownlint } from "../../doctor/generators/markdownlint.ts";
import { generateOxlint } from "../../doctor/generators/oxlint.ts";
import { generatePackageJson } from "../../doctor/generators/package-json.ts";
import { generatePrettier } from "../../doctor/generators/prettier.ts";
import { generateRenovate } from "../../doctor/generators/renovate.ts";
import type { DoctorOptions, GeneratedFile, ProjectReport } from "../../doctor/types.ts";
import { gitSync, gitSyncQuiet } from "../../utils/git.ts";
import { log, raw } from "../../utils/output.ts";

export function collectFiles(
  report: ProjectReport,
  opts: DoctorOptions,
  filter: Set<string> | null,
): GeneratedFile[] {
  const ctx = { report, options: opts };
  const out: GeneratedFile[] = [];
  const accept = (id: string, files: GeneratedFile[]): void => {
    if (filter && !filter.has(id)) return;
    out.push(...files);
  };

  const isTs = report.languages.includes("typescript")
    || report.languages.includes("javascript");
  const hasAnyFormatter = report.existing.oxlint || report.existing.biome
    || report.existing.eslint || report.existing.dprint || report.existing.prettier;
  if (!report.existing.oxlint) accept("oxlint", generateOxlint(ctx));
  if (!report.existing.biome) accept("biome", generateBiome(ctx));
  if (!report.existing.knip) accept("knip", generateKnip(ctx));
  if (!report.existing.jscpd) accept("jscpd", generateJscpd(ctx));
  if (!report.existing.dprint) accept("dprint", generateDprint(ctx));
  if (!report.existing.markdownlint) accept("markdownlint", generateMarkdownlint(ctx));
  if (isTs && !hasAnyFormatter) accept("prettier", generatePrettier(ctx));
  if (isTs && !report.existing.madge) accept("madge", generateMadge(ctx));
  if (report.git.isGitRepo && !report.existing.renovate && !report.existing.dependabot) {
    accept("renovate", generateRenovate(ctx));
    accept("dependabot", generateDependabot(ctx));
  }
  if (report.git.isGitRepo && report.existing.workflows) {
    accept("actionlint", generateActionlint(ctx));
  }
  if (!report.existing.lefthook && opts.tools?.includes("lefthook")) {
    accept("lefthook", generateLefthook(ctx));
  }
  if (!report.existing.eslint && opts.tools?.includes("eslint")) {
    accept("eslint", generateEslint(ctx));
  }
  accept("commitlint", generateCommitlint(ctx));
  if (!report.existing.preCommit || !report.existing.prePush) {
    accept("preCommit", generateHooks(ctx));
  }
  accept("gitignore", generateGitignore(ctx));
  accept("editorconfig", generateEditorconfig(ctx));
  accept("packageJson", generatePackageJson(ctx));

  return out;
}

export function writeAll(root: string, files: GeneratedFile[]): number {
  let n = 0;
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    if (f.merge && existsSync(abs)) {
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
      } catch (e) {
        log("warn", `merge skipped for ${f.path}: invalid JSON (${(e as Error).message})`);
        writeFileSync(abs, f.content);
        n++;
        raw(`   wrote ${f.path}`);
        continue;
      }
      const incoming = JSON.parse(f.content) as Record<string, unknown>;
      // ponytail: deep-merge ONLY for package.json `scripts` (user scripts
      // would otherwise be wiped by the doctor block). Top-level keys are
      // shallow-merged so existing fields like `name`/`type`/`dependencies`
      // are preserved; for arrays/primitives, incoming wins.
      const merged: Record<string, unknown> = { ...existing };
      for (const [k, v] of Object.entries(incoming)) {
        if (
          v && typeof v === "object" && !Array.isArray(v)
          && existing[k] && typeof existing[k] === "object"
          && !Array.isArray(existing[k])
          && f.path === "package.json" && k === "scripts"
        ) {
          merged[k] = {
            ...(existing[k] as Record<string, unknown>),
            ...(v as Record<string, unknown>),
          };
        } else {
          merged[k] = v;
        }
      }
      writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`);
    } else {
      writeFileSync(abs, f.content);
    }
    if (f.executable) {
      try {
        chmodSync(abs, 0o755);
      } catch { /* non-fatal on Windows */ }
    }
    raw(`   wrote ${f.path}`);
    n++;
  }
  return n;
}

export function applyGitConfig(
  report: ProjectReport,
  root: string,
): void {
  if (!report.git.isGitRepo) return;

  // Linear history: pull.ff=only + branch.<current>.rebase=true
  if (!report.git.hasLinearHistoryConfig) {
    try {
      gitSync(root, "config", "pull.ff", "only");
      const cur = gitSyncQuiet(root, "branch", "--show-current");
      if (cur) gitSync(root, "config", `branch.${cur}.rebase`, "true");
      log("info", "git config: pull.ff=only + branch.<current>.rebase=true");
    } catch (e) {
      log("warn", `git config failed: ${(e as Error).message}`);
    }
  }

  // core.hooksPath: point at .githooks/ when hooks were written
  const hooksPath = join(root, ".githooks");
  if (existsSync(hooksPath)) {
    try {
      gitSync(root, "config", "core.hooksPath", ".githooks");
      log("info", "git config: core.hooksPath = .githooks");
    } catch (e) {
      log("warn", `git config core.hooksPath failed: ${(e as Error).message}`);
    }
  }
}
