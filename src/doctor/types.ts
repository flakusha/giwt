// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Shared types for `giwt doctor`.
 *
 * Pure data — no FS I/O. Each generator module takes `ProjectReport` +
 * `DoctorOptions` and returns `GeneratedFile[]`.
 */

export type { ProjectReport } from "./detect.ts";
export type {
  RecommendResult,
  ToolCategory,
  ToolId,
  ToolRecommendation,
  ToolStatus,
} from "./recommend.ts";
import type { ProjectReport } from "./detect.ts";
import type { ToolId } from "./recommend.ts";

export interface DoctorOptions {
  /** Subset of tools to act on. Undefined = act on all recommended. */
  tools?: ToolId[];
  /** When true, do NOT write files; only print the plan. */
  dryRun?: boolean;
  /** Override the project root (defaults to `worktreeRoot`). */
  root?: string;
}

export interface GeneratedFile {
  /** Path relative to project root. Use forward slashes. */
  path: string;
  /** Exact file content. */
  content: string;
  /** Set true to chmod 0755 after write. */
  executable?: boolean;
  /** True when this file replaces a JSON object that should be merged
   *  with the existing one rather than overwriting. */
  merge?: boolean;
}

export interface GeneratorContext {
  report: ProjectReport;
  options: DoctorOptions;
}
