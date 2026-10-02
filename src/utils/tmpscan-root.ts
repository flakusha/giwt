// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Root validation and mount/filesystem introspection for `giwt tmp`,
 * split out of tmpscan.ts for size. Re-exported from tmpscan.ts.
 */

import { readFileSync, realpathSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

/** Paths that must never be a cleanup root, even when they also pass the
 *  allowlist above by alias (defense in depth). */
const FORBIDDEN_ROOTS: Record<string, true> = {
  "/": true,
  "/bin": true,
  "/boot": true,
  "/dev": true,
  "/etc": true,
  "/home": true,
  "/lib": true,
  "/lib64": true,
  "/media": true,
  "/mnt": true,
  "/opt": true,
  "/proc": true,
  "/root": true,
  "/run": true,
  "/sbin": true,
  "/srv": true,
  "/sys": true,
  "/usr": true,
  "/var": true,
};

/** The only roots `giwt tmp` will ever scan or clean: the canonical /tmp,
 *  os.tmpdir(), and $TMPDIR when set. Everything else — /home subdirs,
 *  system dirs, relative paths, symlinks pointing elsewhere — refuses.
 *  Returns the realpath that all later checks are anchored to. */
export function validateTmpRoot(root: string): string {
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) {
    throw new Error(`giwt tmp: root must be an absolute path (got ${root})`);
  }
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    throw new Error(`giwt tmp: root ${root} does not exist or is unreadable`);
  }
  const allowed: Record<string, true> = { "/tmp": true, [resolve(tmpdir())]: true };
  const tmpdirEnv = process.env.TMPDIR;
  if (tmpdirEnv && isAbsolute(tmpdirEnv)) {
    try {
      allowed[realpathSync(resolve(tmpdirEnv))] = true;
    } catch {
      // unresolvable TMPDIR contributes nothing
    }
  }
  if (FORBIDDEN_ROOTS[real]) {
    throw new Error(`giwt tmp: refusing root ${real} — system path`);
  }
  // Any path strictly under an allowed temp root is acceptable (a /tmp
  // subdir is still /tmp); anything else — /home, /var/work, whatever —
  // refuses. The canonical roots themselves are already in `allowed`.
  const underAllowed = Object.keys(allowed).some((k) => real === k || real.startsWith(k + sep));
  if (!underAllowed) {
    throw new Error(
      `giwt tmp: refusing root ${root} — only paths under ${
        Object.keys(allowed).sort().join(", ")
      } are cleanable (never /home, /etc, or other system paths)`,
    );
  }
  return real;
}

interface MountLine {
  dir: string;
  type: string;
  source: string;
}

/** Filesystem type + RAM-backness for the mount carrying root. Reads
 *  /proc/mounts (Linux); anything unavailable degrades to null/false. */
export function mountInfoFor(root: string): {
  fsType: string | null;
  ramBacked: boolean;
} {
  let mounts: string;
  try {
    mounts = readFileSync("/proc/mounts", "utf8");
  } catch {
    return { fsType: null, ramBacked: false };
  }
  let best: MountLine | null = null;
  for (const line of mounts.split("\n")) {
    const [source, dir, type] = line.split(" ");
    if (!source || !dir || !type) continue;
    const prefix = dir === "/" ? "/" : dir.endsWith("/") ? dir : dir + "/";
    if (root === dir || root.startsWith(prefix)) {
      if (!best || dir.length > best.dir.length) best = { dir, type, source };
    }
  }
  if (!best) return { fsType: null, ramBacked: false };
  const ramBacked = best.type === "tmpfs" || best.type === "ramfs"
    || best.source.startsWith("/dev/zram");
  return { fsType: best.type, ramBacked };
}

export function statfsNumbers(root: string): {
  freeBytes: number | null;
  totalBytes: number | null;
} {
  try {
    const s = statfsSync(root);
    return {
      freeBytes: Number(s.bavail) * Number(s.bsize),
      totalBytes: Number(s.blocks) * Number(s.bsize),
    };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}
