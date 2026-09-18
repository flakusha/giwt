// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Project structure detection for `giwt doctor`.
 *
 * Pure FS scan over a project root. Returns a structured report — no side
 * effects, no spawning. Caller decides what to recommend.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";

export interface ProjectReport {
  root: string;
  languages: Language[];
  packageManager: PackageManager | null;
  runtimes: Runtime[];
  /** Frontend+backend split detected when both src/frontend and src/server exist. */
  hasFrontend: boolean;
  hasBackend: boolean;
  hasNative: boolean; // cargo / src-tauri / native/ dir
  /** Existing config files (relative paths). Missing files = absent tools. */
  existing: ExistingTooling;
  /** Git hygiene signals. */
  git: GitHygiene;
  /** Detected license (SPDX identifier or 'unknown'). */
  license: string;
  /** package.json "name" + "type" if present. */
  pkgName: string | null;
  pkgType: string | null; // "module" | "commonjs" | null
}

export type Language =
  | "typescript"
  | "javascript"
  | "rust"
  | "shell"
  | "markdown"
  | "html"
  | "css"
  | "python"
  | "go";

export type PackageManager = "bun" | "deno" | "pnpm" | "npm" | "yarn";

export type Runtime = "bun" | "deno" | "node";

export interface ExistingTooling {
  oxlint: boolean;
  biome: boolean;
  eslint: boolean;
  knip: boolean;
  jscpd: boolean;
  dprint: boolean;
  stylelint: boolean;
  markuplint: boolean;
  markdownlint: boolean;
  typeCoverage: boolean;
  giwt: boolean;
  preCommit: boolean;
  postCommit: boolean;
  prePush: boolean;
  husky: boolean;
  lefthook: boolean;
  linearHistory: boolean;
  pushProtection: boolean;
  prettier: boolean;
  madge: boolean;
  renovate: boolean;
  dependabot: boolean;
  workflows: boolean;
}

export interface GitHygiene {
  isGitRepo: boolean;
  hooksPath: string | null;
  protectedBranches: string[];
  agentEmail: string | null;
  /** pull.ff=only or branch.<x>.rebase=true. */
  hasLinearHistoryConfig: boolean;
}

const LANGUAGE_EXTENSIONS: Record<Language, readonly string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  rust: [".rs"],
  shell: [".sh", ".bash", ".zsh"],
  markdown: [".md", ".mdx"],
  html: [".html", ".htm", ".mustache", ".hbs"],
  css: [".css", ".scss", ".sass", ".less"],
  python: [".py"],
  go: [".go"],
};

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];

const SKIP_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
  ".tmp": true,
  dist: true,
  build: true,
  coverage: true,
  ".hermes": true,
  ".cache": true,
  ".serena": true,
  tree: true,
  target: true,
  ".venv": true,
  vendor: true,
};

/**
 * Run a complete project scan. `root` must exist and be a directory.
 * Never throws on missing files — returns sensible empty values.
 */
export function detectProject(root: string): ProjectReport {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`doctor: ${root} is not a directory`);
  }

  const pkg = readPackageJson(root);
  const lockfiles = listLockfiles(root);
  const pkgManager = inferPackageManager(lockfiles, pkg);
  const runtimes = inferRuntimes(root, pkg, lockfiles);
  const hasFrontend = existsSync(join(root, "src", "frontend"));
  const hasBackend = existsSync(join(root, "src", "server"))
    || existsSync(join(root, "src", "backend"));
  const hasNative = existsSync(join(root, "Cargo.toml"))
    || existsSync(join(root, "native"))
    || existsSync(join(root, "src-tauri"));

  return {
    root,
    languages: detectLanguages(root),
    packageManager: pkgManager,
    runtimes,
    hasFrontend,
    hasBackend,
    hasNative,
    existing: detectExistingTooling(root, pkg),
    git: detectGitHygiene(root),
    license: detectLicense(root),
    pkgName: pkg?.name ?? null,
    pkgType: pkg?.type ?? null,
  };
}

// ── Languages ──────────────────────────────────────────────────

function detectLanguages(root: string): Language[] {
  const counts: Record<Language, number> = {
    typescript: 0,
    javascript: 0,
    rust: 0,
    shell: 0,
    markdown: 0,
    html: 0,
    css: 0,
    python: 0,
    go: 0,
  };
  walkExt(root, (ext) => {
    for (
      const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS) as Array<
        [Language, readonly string[]]
      >
    ) {
      if (exts.includes(ext)) counts[lang]++;
    }
  }, 6);
  return (Object.entries(counts) as Array<[Language, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

// ── Package manager / runtime ───────────────────────────────────

interface PackageJson {
  name?: string;
  type?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function listLockfiles(root: string): Record<PackageManager, boolean> {
  return {
    bun: existsSync(join(root, "bun.lock"))
      || existsSync(join(root, "bun.lockb")),
    deno: existsSync(join(root, "deno.lock")),
    pnpm: existsSync(join(root, "pnpm-lock.yaml")),
    npm: existsSync(join(root, "package-lock.json")),
    yarn: existsSync(join(root, "yarn.lock")),
  };
}

/** Pick the strongest signal. packageManager field wins, then lockfiles. */
function inferPackageManager(
  locks: Record<PackageManager, boolean>,
  pkg: PackageJson | null,
): PackageManager | null {
  if (pkg?.packageManager) {
    const name = pkg.packageManager.split("@")[0];
    if (
      name === "bun" || name === "deno" || name === "pnpm"
      || name === "npm" || name === "yarn"
    ) {
      return name as PackageManager;
    }
  }
  if (locks.bun) return "bun";
  if (locks.deno) return "deno";
  if (locks.pnpm) return "pnpm";
  if (locks.yarn) return "yarn";
  if (locks.npm) return "npm";
  return null;
}

function inferRuntimes(
  root: string,
  pkg: PackageJson | null,
  locks: Record<PackageManager, boolean>,
): Runtime[] {
  const out: Runtime[] = [];
  if (locks.bun) out.push("bun");
  if (locks.deno) out.push("deno");
  if (
    existsSync(join(root, "node_modules"))
    || pkg?.dependencies || pkg?.devDependencies
  ) out.push("node");
  return out;
}

// ── Existing tooling ────────────────────────────────────────────

function detectExistingTooling(
  root: string,
  pkg: PackageJson | null,
): ExistingTooling {
  const hasAny = (candidates: readonly string[]): boolean =>
    candidates.some((p) => existsSync(join(root, p)));

  const hasDevDep = (name: string): boolean => {
    if (!pkg) return false;
    return Boolean(pkg.devDependencies?.[name] || pkg.dependencies?.[name]);
  };

  return {
    oxlint: hasAny([".oxlintrc.json", "oxlint.config.ts", "oxlint.config.js"]),
    biome: hasAny(["biome.json", "biome.jsonc"]),
    eslint: hasAny([
      "eslint.config.mjs",
      "eslint.config.js",
      "eslint.config.cjs",
      ".eslintrc.json",
    ]),
    knip: hasAny(["knip.json", "knip.jsonc"]),
    jscpd: hasAny([".jscpd.json", "jscpd.json"]),
    dprint: hasAny(["dprint.json"]),
    stylelint: hasAny([".stylelintrc", ".stylelintrc.json", "stylelint.config.js"]),
    markuplint: hasAny([".markuplintrc", ".markuplintrc.json"]),
    markdownlint: hasAny([
      ".markdownlint.json",
      ".markdownlint.yaml",
      ".markdownlint-cli2.yaml",
      ".markdownlint.jsonc",
    ]),
    typeCoverage: hasDevDep("type-coverage"),
    giwt: hasDevDep("giwt") || existsSync(join(root, "bin", "giwt")),
    preCommit: hasAny([".githooks/pre-commit", ".husky/pre-commit"]),
    postCommit: hasAny([".githooks/post-commit", ".husky/post-commit"]),
    prePush: hasAny([".githooks/pre-push", ".husky/pre-push"]),
    husky: existsSync(join(root, ".husky")),
    lefthook: hasAny(["lefthook.yml", ".lefthook.yml"]),
    linearHistory: false,
    pushProtection: false,
    prettier: hasAny([
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yaml",
      ".prettierrc.yml",
      "prettier.config.js",
      "prettier.config.cjs",
      "prettier.config.mjs",
    ]),
    madge: hasAny(["madge.config.js", "madge.config.cjs", "madge.config.mjs"]),
    renovate: hasAny(["renovate.json", "renovate.json5"]),
    dependabot: hasAny([".github/dependabot.yml", ".github/dependabot.yaml"]),
    workflows: existsSync(join(root, ".github", "workflows")),
  };
}

// ── Git hygiene ─────────────────────────────────────────────────

function detectGitHygiene(root: string): GitHygiene {
  const gitDir = join(root, ".git");
  const isGitRepo = existsSync(gitDir);

  let hooksPath: string | null = null;
  if (isGitRepo) {
    const out = Bun.spawnSync(["git", "-C", root, "config", "core.hooksPath"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (out.exitCode === 0) {
      const value = out.stdout.toString().trim();
      if (value) hooksPath = value;
    }
  }

  const credPath = join(root, ".credentials.env");
  let agentEmail: string | null = null;
  if (existsSync(credPath)) {
    try {
      const content = readFileSync(credPath, "utf8");
      const match = content.match(/^\s*AGENT_GPG_EMAIL\s*=\s*(.+?)\s*$/m);
      if (match) agentEmail = unquote(match[1]!);
    } catch {
      agentEmail = null;
    }
  }

  let hasLinearHistoryConfig = false;
  if (isGitRepo) {
    const out = Bun.spawnSync(
      [
        "git",
        "-C",
        root,
        "config",
        "--get-regexp",
        "^(pull\\.ff|branch\\..*\\.rebase)$",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = out.stdout.toString();
    // `git config --get-regexp` prints "key value", unlike `--list` ("key=value").
    hasLinearHistoryConfig = /pull\.ff\s*=?\s*only/.test(stdout)
      || /branch\..+\.rebase\s*=?\s*true/.test(stdout);
  }

  return {
    isGitRepo,
    hooksPath,
    protectedBranches: readProtectedBranches(root),
    agentEmail,
    hasLinearHistoryConfig,
  };
}

function readProtectedBranches(root: string): string[] {
  const protectedSet: Record<string, true> = {
    master: true,
    main: true,
    stg: true,
    dev: true,
  };
  const prePush = join(root, ".githooks", "pre-push");
  if (existsSync(prePush)) {
    try {
      const content = readFileSync(prePush, "utf8");
      const match = content.match(/protected="([^"]+)"/);
      if (match) {
        for (const part of match[1]!.split("|")) {
          const stripped = part.replace(/[$()]/g, "");
          if (stripped) protectedSet[stripped] = true;
        }
      }
    } catch { /* keep defaults */ }
  }
  return Object.keys(protectedSet);
}

// ── License ─────────────────────────────────────────────────────

const SPDX_RE = /\bSPDX-License-Identifier:\s*([A-Za-z0-9.\-+()]+)/;

function detectLicense(root: string): string {
  let foundSpdx: string | null = null;
  walkFiles(root, (file) => {
    if (foundSpdx) return;
    if (!/\.(ts|js|rs|sh|py|mjs|cjs)$/.test(file)) return;
    try {
      const head = readFileSync(file, "utf8").slice(0, 1024);
      const m = head.match(SPDX_RE);
      if (m) foundSpdx = m[1]!;
    } catch { /* ignore unreadable */ }
  }, 4);
  if (foundSpdx) return foundSpdx;

  for (const name of LICENSE_FILES) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    try {
      const head = readFileSync(path, "utf8").slice(0, 4096);
      const m = head.match(SPDX_RE);
      if (m) return m[1]!;
      const lower = head.toLowerCase();
      if (lower.includes("agpl")) return "AGPL-3.0-or-later";
      if (lower.includes("lgpl")) return "LGPL-3.0-or-later";
      if (lower.includes("apache")) return "Apache-2.0";
      if (lower.includes("mit license")) return "MIT";
      return "unknown";
    } catch { /* fall through */ }
  }
  return "unknown";
}

// ── Helpers ─────────────────────────────────────────────────────

function walkExt(root: string, visit: (ext: string) => void, maxDepth: number): void {
  walkFiles(root, (file) => {
    const slash = file.lastIndexOf("/");
    const dot = file.lastIndexOf(".");
    if (dot > slash) visit(file.slice(dot));
  }, maxDepth);
}

function walkFiles(
  root: string,
  visit: (file: string) => void,
  maxDepth: number,
): void {
  const stack: Array<{ dir: string; depth: number; }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > maxDepth) continue;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as Dirent<string>[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS[entry.name]) {
          stack.push({ dir: join(dir, entry.name), depth: depth + 1 });
        }
      } else if (entry.isFile()) {
        visit(join(dir, entry.name));
      }
    }
  }
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}
