// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Docusaurus config generator.
 *
 * Emits `docusaurus.config.ts`. Minimal: title + URL placeholders + empty
 * nav/projects; no plugins.
 */

import type { GeneratedFile, GeneratorContext } from "../types.ts";

const DOCUSAURUS_CONFIG_TS = `// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors
//
// Docusaurus — documentation site generator
// https://docusaurus.io/docs/api/docusaurus-config

import type { Config } from "@docusaurus/types";

const config: Config = {
  title: "__TITLE__",
  tagline: "__TITLE__ documentation",
  url: "https://example.com",
  baseUrl: "/",
  organizationName: "example",
  projectName: "__TITLE__",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  presets: [],
  themes: [],
};

export default config;
`;

export function generateDocusaurus(ctx: GeneratorContext): GeneratedFile[] {
  const title = ctx.report.pkgName ?? "Docs";
  const content = DOCUSAURUS_CONFIG_TS.replace(/__TITLE__/g, title);
  return [{ path: "docusaurus.config.ts", content }];
}
