// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Pijul-native tracked blob providers for the resurrected detector.
 *
 * Source of truth: `pijul list` (the tracked-path set from pijul state) plus
 * the working-tree file bytes. No git spawn. Each path's TrackedBlob.sha is
 * a sha256 of its bytes, used only as the content identity the shared twin
 * scanner groups and caches by — pijul change hashes are immutable patch ids
 * and are not blob identities.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { TrackedBlobProvider } from "../audit/resurrected";
import type { BlobTextProvider } from "../audit/twins";
import { defaultPijulSpawn, type PijulSpawn } from "../vcs/pijul";

export interface PijulResurrectedProviders {
  trackedBlobs: TrackedBlobProvider;
  blobText: BlobTextProvider;
}

/** Providers share a sha → path map so twin reads need no second pijul call. */
export function pijulResurrectedProviders({
  root,
  spawn = defaultPijulSpawn,
}: {
  root: string;
  spawn?: PijulSpawn;
}): PijulResurrectedProviders {
  const pathBySha = new Map<string, string>();
  return {
    trackedBlobs: ({ dir, maxFiles }) => {
      const result = spawn(["pijul", "list", "--repository", root], root);
      if (result.exitCode !== 0) {
        throw new Error(
          `pijul list failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
        );
      }
      const normalized = dir.replace(/^\.\//, "").replace(/\/+$/, "");
      const prefix = normalized === "" || normalized === "." ? "" : `${normalized}/`;
      const blobs = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((path) => path !== "" && (path === normalized || path.startsWith(prefix)))
        // `pijul list` also prints directories; only files are blob records.
        .filter((path) => {
          try {
            return statSync(join(root, path)).isFile();
          } catch {
            return false;
          }
        })
        .map((path) => {
          const absolute = join(root, path);
          const sha = createHash("sha256").update(readFileSync(absolute)).digest("hex");
          pathBySha.set(sha, absolute);
          return { sha, path };
        });
      return blobs
        .sort((a, b) => posix.basename(a.path).localeCompare(posix.basename(b.path)))
        .slice(0, maxFiles);
    },
    blobText: ({ sha, maxBytes, cache }) => {
      const cached = cache.get(sha);
      if (cached !== undefined) return cached;
      const path = pathBySha.get(sha);
      if (path === undefined) {
        cache.set(sha, null);
        return null;
      }
      let text: string | null = null;
      try {
        const bytes = readFileSync(path);
        if (bytes.byteLength <= maxBytes && !bytes.includes(0)) text = bytes.toString("utf8");
      } catch {
        // Same contract as git blobText: unreadable content never fails a scan.
      }
      cache.set(sha, text);
      return text;
    },
  };
}

// ponytail: sha256 of working-tree bytes, not pijul change ids — historic or
// unstaged-change blobs are invisible and files changing between list and read
// are a TOCTOU window. Revisit with change-hash-backed reads if either matters.
