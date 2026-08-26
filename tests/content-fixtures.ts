import { transitionEntryStatus, type Entry } from "../src/content/index.ts";

export function ensurePublished(entry: Entry, at = new Date("2098-12-31T00:00:00.000Z")): Entry {
  if (entry.status === "published") return entry;
  return transitionEntryStatus(
    entry,
    { expected_version: entry.version, expected_sha: "a".repeat(40) },
    "published",
    at,
  );
}
