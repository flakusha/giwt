// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Package-manager and runtime detection for `giwt doctor`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageManager, Runtime } from "./types.ts";

export interface PackageJson {
  name?: string;
  type?: string;
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

export function listLockfiles(root: string): Record<PackageManager, boolean> {
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
export function inferPackageManager(
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

export function inferRuntimes(
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
