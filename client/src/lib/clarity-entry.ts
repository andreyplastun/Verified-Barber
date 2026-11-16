export type EntryType = "review_link" | "website";
const storageKey = "rateus_clarity_entry_type";

export function classifyEntry(pathname: string): EntryType {
  return /^\/(?:review|r|visit-confirm)\//.test(pathname) ? "review_link" : "website";
}

/** First entry in this tab wins; a blocked storage still retains it in memory. */
export function createEntryTracker() {
  let entry: EntryType | undefined;
  return (pathname: string, getStorage: () => Pick<Storage, "getItem" | "setItem">): EntryType => {
    if (entry) return entry;
    entry = classifyEntry(pathname);
    try {
      const storage = getStorage();
      const saved = storage.getItem(storageKey);
      if (saved === "review_link" || saved === "website") entry = saved;
      else storage.setItem(storageKey, entry);
    } catch {
      // Private browsing can disable sessionStorage; keep the first value in memory.
    }
    return entry;
  };
}
