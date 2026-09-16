// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * happy-dom config generator.
 *
 * Emits `happy-dom.config.json`. Used by vitest's `environment: "happy-dom"`
 * for unit tests that need a DOM without spinning up a real browser.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const HAPPY_DOM_CONFIG = {
  settings: {
    disableCSSFileLoading: true,
    disableJavaScriptEvaluation: false,
    disableJavaScriptFileLoading: true,
    enableFileSystemHttpRequests: false,
  },
} as const;

export function generateHappyDom(_ctx: GeneratorContext): GeneratedFile[] {
  return [
    {
      path: "happy-dom.config.json",
      content: JSON.stringify(HAPPY_DOM_CONFIG, null, 2) + "\n",
    },
  ];
}
