// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Color/no-color environment detection.
 *
 * All color formatting lives in `src/utils/output.ts` (`colorize`,
 * `colors`); this module exposes only `isNoColor()` so other modules
 * can gate on NO_COLOR / agent / CI environments.
 */
export function isNoColor(): boolean {
  return (
    process.env.NO_COLOR !== undefined
    || process.env.OPENCODE !== undefined
    || process.env.OMP !== undefined
    || process.env.CI !== undefined
    || process.env.TERM === "dumb"
  );
}
