// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** Flag tokens `ticket` accepts in its arg tail. Static table per repo
 * convention (Set/Map are for dynamic membership only). */
const FLAG_TOKENS: Record<string, true> = {
  "-l": true,
  "--label": true,
  "-p": true,
  "--priority": true,
  "-e": true,
  "--epic": true,
  "--effort": true,
  "--tag": true,
};

export interface TicketFlags {
  labels: string[];
  priority: string;
  epic: string;
  tags: string[];
  effort: string;
}

/** Apply one flag + its value token to a flags record. Undefined value
 * (flag at end of args) is ignored — parity with the previous scan. */
function applyFlag(flags: TicketFlags, token: string, value: string | undefined): void {
  switch (token) {
    case "-l":
    case "--label": {
      if (value !== undefined) {
        flags.labels.push(...value.split(",").map((l) => l.trim()).filter((l) => l.length > 0));
      }
      break;
    }
    case "-p":
    case "--priority": {
      if (value !== undefined) flags.priority = value;
      break;
    }
    case "-e":
    case "--epic": {
      if (value !== undefined) flags.epic = value;
      break;
    }
    case "--effort": {
      if (value !== undefined) flags.effort = value;
      break;
    }
    case "--tag": {
      if (value !== undefined) {
        flags.tags.push(...value.split(",").map((t) => t.trim()).filter((t) => t.length > 0));
      }
      break;
    }
  }
}

/** Result of splitting the `ticket` arg tail (everything after
 * `TYPE TITLE`): the parsed flags plus the positional body. */
export interface ParsedTicketArgs {
  flags: TicketFlags;
  body: string;
}

/** Split the arg tail after `TYPE TITLE` into flags and the positional body
 * with one left-to-right scan
 * (BUG-giwt-ticket-drops-flags-that-follow-the-positional-body). Known flags
 * are consumed wherever they appear — before or after the body — each
 * swallowing its value token; `--` ends flag parsing (everything after is
 * positional); unknown `-`-prefixed tokens are positionals, so a
 * dash-leading body keeps working; extra positionals are ignored, matching
 * the old args.slice(3) scan. */
export function parseTicketArgs(tail: string[]): ParsedTicketArgs {
  const flags: TicketFlags = { labels: [], priority: "", epic: "", effort: "Medium", tags: [] };
  const positionals: string[] = [];
  for (let i = 0; i < tail.length; i++) {
    const token = tail[i];
    if (token === undefined) break;
    if (token === "--") {
      positionals.push(...tail.slice(i + 1));
      break;
    }
    if (FLAG_TOKENS[token] === true) {
      const value = tail[i + 1];
      if (value !== undefined) i++;
      applyFlag(flags, token, value);
    } else {
      positionals.push(token);
    }
  }
  return { flags, body: positionals[0] ?? "" };
}
