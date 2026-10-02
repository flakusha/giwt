// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 giwt Contributors

/** `giwt ticket` — public shell. Implementations live in ./ticket/*;
 * every named export stays importable from this module path. */

export { parseTicketArgs, type TicketFlags } from "./ticket/args";
export { closeTicketFile, closeTickets } from "./ticket/close";
export { copyTickets } from "./ticket/copy";
export { renderTicketFile, stripTypePrefix, ticket } from "./ticket/create";
export { hunkCount, threeWay } from "./ticket/threeway";
