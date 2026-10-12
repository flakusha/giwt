// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * File discovery for the SPDX header guard: extension allowlist, exclusion
 * patterns, and git-backed file listing (staged / tracked).
 */
import { $ } from "bun";

type GitRunner = (command: string) => Promise<string>;
let gitRunner: GitRunner = async (command) => await $`${command}`.text();
export function setGitRunner(runner: GitRunner): void {
  gitRunner = runner;
}

const HAS_CHECKABLE_EXTENSION: Record<string, true> = {
  ".ts": true,
  ".tsx": true,
  ".js": true,
  ".mjs": true,
  ".html": true,
  ".css": true,
  ".md": true,
  ".mdx": true,
};

const DEFAULT_EXCLUDE_PATTERNS: RegExp[] = [
  /\/migrations\//,
  /\/node_modules\//,
  /\/dist\//,
  /\.d\.ts$/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];

let extraExcludePatterns: RegExp[] = [];

export function setExcludePatterns(patterns: RegExp[]): void {
  extraExcludePatterns = patterns;
}

export function isExcluded(filePath: string): boolean {
  return [...DEFAULT_EXCLUDE_PATTERNS, ...extraExcludePatterns].some((p) => p.test(filePath));
}

export function hasCheckableExtension(filePath: string): boolean {
  return HAS_CHECKABLE_EXTENSION[filePath.slice(filePath.lastIndexOf("."))] === true;
}

export function filterCheckableFiles(files: string[]): string[] {
  return files
    .filter((f) => f.trim().length > 0)
    .filter(hasCheckableExtension)
    .filter((f) => !isExcluded(f));
}

export async function getStagedFiles(): Promise<string[]> {
  const result = await gitRunner("git diff --cached --name-only --diff-filter=ACM");
  return filterCheckableFiles(result.split("\n"));
}

/** List every tracked file (git ls-files) with a checkable extension. */
export async function getTrackedFiles(): Promise<string[]> {
  const result = await gitRunner("git ls-files");
  return filterCheckableFiles(result.split("\n"));
}
