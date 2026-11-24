import { notInArray, sql } from "drizzle-orm";
import { waMessages } from "@shared/schema";

export function unseenWaCandidate(seen: number[]) {
  // Drizzle expands JS arrays into SQL tuples; do not cast a tuple to int[].
  return seen.length ? notInArray(waMessages.id, seen) : sql`TRUE`;
}
