// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * vitest config generator.
 *
 * Emits vitest.config.ts with defineConfig from vitest/config.
 * Node environment, no globals, picks up src tree test files.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const VITEST_CONFIG_TS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// vitest — test runner
// https://vitest.dev/config/

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
  },
});
`;

export function generateVitest(_ctx: GeneratorContext): GeneratedFile[] {
  return [{ path: "vitest.config.ts", content: VITEST_CONFIG_TS }];
}
