import { randomBytes } from "node:crypto";

export const TICKET_SUBJECT_MAX_LENGTH = 100;
export const TICKET_CONTENT_MAX_LENGTH = 5_000;

export function createTicketNumber(
  now = new Date(),
  randomPart = randomBytes(8).toString("hex"),
) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `TK-${year}${month}${day}-${randomPart.toUpperCase()}`;
}
