// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * Mesh-VPN discovery: best-effort tailscale MagicDNS candidates for remote
 * names (`giwt backup remote --discover`). The tool is optional — absence
 * yields an empty candidate list plus a note, never a failure.
 */

export interface TailscalePeer {
  dnsName: string;
  hostName: string;
  online: boolean;
}

export interface DiscoveryResult {
  peers: TailscalePeer[];
  note: string;
}

interface TailscaleStatusJson {
  Peer?: Record<string, { DNSName?: string; HostName?: string; Online?: boolean; }>;
}

export type StatusSpawn = (
  cmd: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string; }>;

/** Parse `tailscale status --json` peers into MagicDNS candidates. */
export function parsePeers(json: string): TailscalePeer[] {
  let parsed: TailscaleStatusJson;
  try {
    parsed = JSON.parse(json) as TailscaleStatusJson;
  } catch {
    return [];
  }
  const peers = Object.values(parsed.Peer ?? {}).flatMap((p) => {
    const dnsName = p.DNSName?.replace(/\.$/, "");
    if (dnsName === undefined || dnsName === "") return [];
    return [{ dnsName, hostName: p.HostName ?? dnsName, online: p.Online === true }];
  });
  return peers.sort((a, b) => a.dnsName.localeCompare(b.dnsName));
}

/** Best-effort discovery: bounded spawn, tolerant of every failure mode. */
export async function discoverPeers(spawn: StatusSpawn): Promise<DiscoveryResult> {
  const res = await spawn(["tailscale", "status", "--json"]);
  if (res.exitCode !== 0) {
    return { peers: [], note: `tailscale status failed (${res.stderr.trim() || "no stderr"})` };
  }
  const peers = parsePeers(res.stdout);
  return {
    peers,
    note: peers.length === 0 ? "tailscale reports no peers" : "",
  };
}
