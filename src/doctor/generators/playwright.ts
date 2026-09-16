// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * playwright config generator.
 *
 * Emits `playwright.config.ts`. Chromium-only by default. If the project
 * has a backend, includes `webServer` so tests can launch the dev server.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const PLAYWRIGHT_CONFIG_TS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// playwright — E2E browser tests
// https://playwright.dev/docs/test-configuration

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
`;

const PLAYWRIGHT_CONFIG_TS_WITH_BACKEND = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// playwright — E2E browser tests
// https://playwright.dev/docs/test-configuration

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
`;

export function generatePlaywright(ctx: GeneratorContext): GeneratedFile[] {
  const content = ctx.report.hasBackend
    ? PLAYWRIGHT_CONFIG_TS_WITH_BACKEND
    : PLAYWRIGHT_CONFIG_TS;
  return [{ path: "playwright.config.ts", content }];
}
