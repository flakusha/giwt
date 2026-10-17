// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { describe, expect, test } from "bun:test";
import { discoverPeers, parsePeers } from "./discover";
import { advanceOffsite, buildRemoteCommand, type RemotePlanInput } from "./remote";

function plan(over: Partial<RemotePlanInput> = {}): RemotePlanInput {
  return {
    kind: "rclone",
    source: "/repo/.backups",
    dest: "nas:backups",
    prune: false,
    allowRemoteDelete: false,
    ...over,
  };
}

describe("off-site command construction", () => {
  test("rclone: copy by default, sync only when deletion is authorized", () => {
    expect(buildRemoteCommand(plan())!.cmd).toEqual([
      "rclone",
      "copy",
      "/repo/.backups/",
      "nas:backups",
    ]);
    expect(
      buildRemoteCommand(plan({ prune: true, allowRemoteDelete: true }))!.cmd,
    ).toEqual(["rclone", "sync", "/repo/.backups/", "nas:backups"]);
  });

  test("rsync: -az without --delete unless deletion is authorized", () => {
    expect(buildRemoteCommand(plan({ kind: "rsync" }))!.cmd).toEqual([
      "rsync",
      "-az",
      "/repo/.backups/",
      "nas:backups",
    ]);
    expect(
      buildRemoteCommand(plan({ kind: "rsync", prune: true, allowRemoteDelete: true }))!.cmd,
    ).toEqual(["rsync", "-az", "/repo/.backups/", "nas:backups", "--delete"]);
  });

  test("ssh: streams the newest archive over stdin", () => {
    const out = buildRemoteCommand(
      plan({
        kind: "ssh",
        dest: "nas",
        archivePath: "/repo/.backups/docs.full.20261017T000000Z.tar.zst",
      }),
    )!;
    expect(out.cmd).toEqual(["ssh", "nas", "cat > docs.full.20261017T000000Z.tar.zst"]);
    expect(out.stdinFile).toBe("/repo/.backups/docs.full.20261017T000000Z.tar.zst");
  });

  test("server-side deletion is default-deny (two-key authorization)", () => {
    // Flag without config → refused.
    expect(buildRemoteCommand(plan({ prune: true }))).toBeNull();
    expect(buildRemoteCommand(plan({ kind: "rsync", prune: true }))).toBeNull();
    // Config without flag → deletion never requested, plain transfer.
    expect(buildRemoteCommand(plan({ allowRemoteDelete: true }))!.cmd).toEqual([
      "rclone",
      "copy",
      "/repo/.backups/",
      "nas:backups",
    ]);
  });

  test("failed verify never advances offsiteAt (gate is pure)", () => {
    expect(advanceOffsite(false)).toBe(false);
    expect(advanceOffsite(true)).toBe(true);
  });
});

describe("tailscale MagicDNS discovery", () => {
  test("peers parse, sort, and lose the trailing dot", () => {
    const json = JSON.stringify({
      Peer: {
        b: { DNSName: "zeta.magic.tail-scale.ts.net.", HostName: "zeta", Online: false },
        a: { DNSName: "alpha.magic.tail-scale.ts.net.", HostName: "alpha", Online: true },
      },
    });
    const peers = parsePeers(json);
    expect(peers.map((p) => p.dnsName)).toEqual([
      "alpha.magic.tail-scale.ts.net",
      "zeta.magic.tail-scale.ts.net",
    ]);
    expect(peers[1]!.online).toBe(false);
  });

  test("malformed json and empty peers degrade with a note", () => {
    expect(parsePeers("not json")).toEqual([]);
    expect(parsePeers("{}")).toEqual([]);
  });

  test("discoverPeers reports tool failure without throwing", async () => {
    const result = await discoverPeers(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "tailscale: command unavailable",
    }));
    expect(result.peers).toEqual([]);
    expect(result.note).toContain("tailscale status failed");
  });
});
