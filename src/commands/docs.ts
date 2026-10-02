// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/**
 * `giwt docs` — list/show/search/dump the repo's markdown corpus.
 *
 * Corpus: AGENTS.md, README.md, docs/*.md (recursive) and .plan/*.md
 * (recursive) under the worktree root, deterministic path sort. A doc's
 * name is its
 * repo-relative path without the `.md` suffix (e.g. `plan/tickets/index`,
 * `AGENTS`). Names resolve case-insensitively.
 *
 * Symlinks resolving outside the repo root are skipped; non-UTF8 files are
 * skipped in list/search and rejected in show/dump.
 */

import { resolve } from "node:path";
import { type WorktreeConfig } from "../utils/config";
import { type OutFormat, parseOutFlags, renderRecords, renderTable } from "../utils/emit";
import { log, raw } from "../utils/output";
import {
  closestNames,
  type Doc,
  extractTitle,
  loadCorpus,
  readTextLoose,
  resolveName,
  utf8OrThrow,
} from "./docs/corpus";

interface Hit {
  name: string;
  line: number;
  text: string;
}

const MAX_SEARCH_HITS = 200;

const USAGE_TEXT = "Usage: giwt docs <list|show|search|dump> [args...]\n"
  + "  list            table of doc names and titles (--json|--toml|--emoji supported)\n"
  + "  show <name>     print a doc with its path header (--json|--toml|--emoji supported)\n"
  + "  search <term>   case-insensitive line search, name:line:text (--json|--toml|--emoji supported)\n"
  + "  dump <name>     raw file bytes, pipe-safe (no header, no color)";

function exitWithError(message: string): never {
  log("error", message);
  process.exit(1);
}

function listCorpus(corpus: Doc[], format: OutFormat): void {
  const rows: Array<[string, string, string]> = [];
  for (const d of corpus) {
    // Binary/non-UTF8 files are skipped in list, not shown blank.
    const text = readTextLoose(d);
    if (text === null) continue;
    rows.push([d.name, extractTitle(text), d.path]);
  }
  if (format !== "human") {
    raw(
      renderRecords(rows.map(([name, title, path]) => ({ name, title, path })), format, {
        emoji: (record) => {
          const r = record as { name: string; title: string; };
          return `📚 ${r.name} — ${r.title}`;
        },
      }),
    );
    return;
  }
  if (rows.length === 0) return;
  raw(renderTable([["Name", "Title"], ...rows.map(([n, t]) => [n, t])], { pad: 2 }));
}

function searchCorpus(corpus: Doc[], term: string, format: OutFormat): void {
  if (corpus.length === 0) exitWithError("no docs found");
  const needle = term.toLowerCase();
  const hits: Hit[] = [];
  let truncated = false;
  for (const doc of corpus) {
    const text = readTextLoose(doc);
    if (text === null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.toLowerCase().includes(needle)) continue;
      if (hits.length >= MAX_SEARCH_HITS) {
        truncated = true;
        break;
      }
      hits.push({ name: doc.name, line: i + 1, text: lines[i]! });
    }
    if (truncated) break;
  }
  if (format !== "human") {
    raw(
      renderRecords(hits, format, {
        emoji: (h) => {
          const hit = h as Hit;
          return `🔍 ${hit.name}:${hit.line}: ${hit.text}`;
        },
      }),
    );
  } else {
    for (const h of hits) raw(`${h.name}:${h.line}: ${h.text}`);
  }
  if (truncated) {
    log("warn", `search output truncated at ${MAX_SEARCH_HITS} hits`);
  }
}

function showDoc(corpus: Doc[], name: string, format: OutFormat): void {
  if (corpus.length === 0) exitWithError("no docs found");
  const doc = resolveName(corpus, name);
  if (!doc) {
    exitWithError(
      `unknown doc '${name}' — closest matches: ${closestNames(corpus, name).join(", ")}`,
    );
  }
  const text = utf8OrThrow(doc.path, doc.rel);
  if (format !== "human") {
    raw(
      renderRecords([{ name: doc.name, path: doc.path, content: text }], format, {
        emoji: (record) => {
          const r = record as { name: string; path: string; content: string; };
          return `📄 ${r.name} (${r.path})\n${r.content}`;
        },
      }),
    );
    return;
  }
  log("info", doc.path);
  // raw() terminates with \n; strip one trailing newline so the emitted
  // bytes match the file exactly for the common newline-terminated doc.
  raw(text.replace(/\n$/, ""));
}

function dumpDoc(corpus: Doc[], name: string): void {
  if (corpus.length === 0) exitWithError("no docs found");
  const doc = resolveName(corpus, name);
  if (!doc) {
    exitWithError(
      `unknown doc '${name}' — closest matches: ${closestNames(corpus, name).join(", ")}`,
    );
  }
  const text = utf8OrThrow(doc.path, doc.rel);
  raw(text.replace(/\n$/, ""));
}

export async function docs(args: string[], config: WorktreeConfig): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    raw(USAGE_TEXT);
    if (args.length === 0) process.exitCode = 1;
    return;
  }
  const sub = args[0]!;
  // Output-format parity with the other data commands: --json|--toml|--emoji
  // via parseOutFlags (FEAT-docs-list-show-search-toml-and-emoji-output-parity).
  const { format, rest } = parseOutFlags(args.slice(1));
  const positionals = rest;
  const root = resolve(config.worktreeRoot);

  switch (sub) {
    case "list": {
      if (positionals.length > 0) {
        exitWithError(`docs list takes no positional args (got '${positionals[0]}')`);
      }
      listCorpus(loadCorpus(root), format);
      return;
    }
    case "show": {
      if (positionals.length !== 1) {
        exitWithError("docs show requires exactly one <name> argument");
      }
      showDoc(loadCorpus(root), positionals[0]!, format);
      return;
    }
    case "search": {
      if (positionals.length !== 1) {
        exitWithError("docs search requires exactly one <term> argument");
      }
      searchCorpus(loadCorpus(root), positionals[0]!, format);
      return;
    }
    case "dump": {
      if (positionals.length !== 1) {
        exitWithError("docs dump requires exactly one <name> argument");
      }
      dumpDoc(loadCorpus(root), positionals[0]!);
      return;
    }
    default:
      exitWithError(`unknown docs subcommand '${sub}'\n${USAGE_TEXT}`);
  }
}
