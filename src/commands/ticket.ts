// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

import { resolve } from "path";
import type { WorktreeConfig } from "../utils/config";
import { getWorktreeRoot, gitSync } from "../utils/git";
import { log, raw } from "../utils/output";

const VALID_TYPES = ["BUG", "FEAT", "FIX", "IDEA", "TASK", "SOL", "INFRA"] as const;
type TicketType = typeof VALID_TYPES[number];

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;

interface TicketFlags {
  labels: string[];
  priority: string;
  epic: string;
  tags: string[];
  effort: string;
}

function kebab(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function ticket(args: string[], config: WorktreeConfig): Promise<void> {
  const typeRaw = args[0]?.toUpperCase() ?? "";
  const title = args[1];
  const body = args[2] ?? "";

  if (!typeRaw || !title) {
    log("error", "type and title required");
    raw(
      "  Usage: ticket <TYPE> <title> [body] [--label X] [--priority X] [--epic X] [--effort X] [--tag X]",
    );
    raw(`  TYPE: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  if (!(VALID_TYPES as readonly string[]).includes(typeRaw)) {
    log("error", `unknown type '${typeRaw}' — use: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  const type = typeRaw as TicketType;
  const flags = parseFlags(args.slice(3));

  if (flags.priority && !(VALID_PRIORITIES as readonly string[]).includes(flags.priority)) {
    log("error", `unknown priority '${flags.priority}' — use: ${VALID_PRIORITIES.join(", ")}`);
    process.exit(1);
  }

  if (!flags.epic) {
    log(
      "warn",
      "no --epic given — ticket will be unbound (giwt sync lists it under the unbound-to-epic advisory)",
    );
  }

  const ticketName = kebab(title);
  const ticketFile = `${config.settings.paths.tickets}/${type}-${ticketName}.md`;
  const extid = `${type}-${ticketName}`;
  const fullTitle = `${extid}: ${title}`;
  // Plan files belong to the checkout in progress (worktree-aware): when the
  // CLI is invoked from inside tree/<branch>, the ticket file must land in
  // that worktree, not the main checkout (config.repoRoot is the *main* root
  // by design, since git issues live in the shared .git store).
  const planRoot = getWorktreeRoot();
  const ticketPath = resolve(planRoot, ticketFile);

  const exists = await Bun.file(ticketPath).exists();
  if (exists) {
    log("warn", `ticket file already exists: ${ticketFile}`);
  } else {
    log("info", `creating ticket file: ${ticketFile}`);

    let content =
      `<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n<!-- SPDX-FileCopyrightText: 2026 giwt Contributors -->\n\n# ${type}: ${title}\n\n`;
    content += `**Status:** ⬜ Not Started\n`;
    content += `**Priority:** ${flags.priority || "Medium"}\n`;
    content += `**Effort:** ${flags.effort}\n`;
    if (flags.epic) {
      content += `**Epic:** ${flags.epic}\n`;
    }
    if (flags.tags.length > 0) {
      content += `**Tags:** ${flags.tags.join(", ")}\n`;
    }
    content += `\n## Summary\n\n${body || "No description provided."}\n\n`;
    content += `## Acceptance Criteria\n\n`;
    content += `- [ ] Implementation complete\n`;
    content += `- [ ] Tests passing\n`;
    content += `- [ ] Documentation updated\n`;

    await Bun.write(ticketPath, content);
    log("success", `created ticket file: ${ticketFile}`);
  }

  log("info", `creating git issue: ${extid}`);
  const issueOutput = gitSync(
    config.repoRoot,
    "issue",
    "create",
    fullTitle,
    "-m",
    body || "No description",
  );

  const hashMatch = issueOutput.match(/[0-9a-f]{7,40}/);
  const hash = hashMatch?.[0];

  if (hash) {
    gitSync(config.repoRoot, "issue", "comment", hash, "-m", `Plan spec: ${ticketFile}`);
    // Single edit invocation: `git issue edit -l` replaces the whole label set,
    // so per-label edits would leave only the last label applied.
    if (flags.labels.length > 0) {
      gitSync(
        config.repoRoot,
        "issue",
        "edit",
        hash,
        ...flags.labels.flatMap((label) => ["-l", label]),
      );
    }
    if (flags.priority) {
      gitSync(config.repoRoot, "issue", "edit", hash, "-p", flags.priority);
    }
    log("success", `created git issue: ${hash}`);
  } else {
    log("warn", "could not extract issue hash");
  }

  log("info", `ticket ${extid} created`);
  raw(`  File:  ${ticketFile}`);
  if (hash) raw(`  Issue: ${hash}`);
}

function parseFlags(args: string[]): TicketFlags {
  const flags: TicketFlags = { labels: [], priority: "", epic: "", effort: "Medium", tags: [] };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-l":
      case "--label": {
        const value = args[++i];
        if (value !== undefined) {
          flags.labels.push(...value.split(",").map((l) => l.trim()).filter((l) => l.length > 0));
        }
        break;
      }
      case "-p":
      case "--priority": {
        const value = args[++i];
        if (value !== undefined) flags.priority = value;
        break;
      }
      case "-e":
      case "--epic": {
        const value = args[++i];
        if (value !== undefined) flags.epic = value;
        break;
      }
      case "--effort": {
        const value = args[++i];
        if (value !== undefined) flags.effort = value;
        break;
      }
      case "--tag": {
        const value = args[++i];
        if (value !== undefined) {
          flags.tags.push(...value.split(",").map((t) => t.trim()).filter((t) => t.length > 0));
        }
        break;
      }
    }
  }
  return flags;
}
