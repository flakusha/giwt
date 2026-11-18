// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Resolve the configured VCS backend; a registered-but-unimplemented
 * backend refuses instead of silently running on git. */

import type { GiwtSettings } from "../utils/settings";
import { gitBackend } from "./git";
import { jjBackend } from "./jj";
import { type VcsBackend, vcsBackendRefusal } from "./types";

export function resolveVcsBackend(settings: GiwtSettings): VcsBackend {
  if (settings.vcs.backend === "git") return gitBackend;
  if (settings.vcs.backend === "jj") return jjBackend;
  throw new Error(vcsBackendRefusal(settings.vcs.backend));
}
