// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, type GiwtSettings } from "../utils/settings";
import { assertGitMutationAllowed } from "./guard";

const settingsFor = (backend: GiwtSettings["vcs"]["backend"]): GiwtSettings => ({
  ...DEFAULT_SETTINGS,
  vcs: { backend },
});

describe("assertGitMutationAllowed", () => {
  test("git backend is a no-op", () => {
    expect(() => assertGitMutationAllowed({ settings: settingsFor("git"), where: "giwt commit" }))
      .not.toThrow();
  });

  for (const backend of ["jj", "pijul"] as const) {
    test(`${backend} backend refuses with an actionable error`, () => {
      let message = "";
      try {
        assertGitMutationAllowed({ settings: settingsFor(backend), where: "giwt commit" });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(backend);
      expect(message).toContain("giwt commit");
      expect(message).toContain("use the native backend commands (giwt jj / giwt pijul)");
      expect(message).toContain("[vcs] backend = \"git\"");
    });
  }
});
