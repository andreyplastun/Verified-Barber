/** Absolute UTC timestamps; Kazakhstan has stayed UTC+5 since March 2024. */
export function nextAltegioSyncAt(now: number): number {
  const local = new Date(now + 5 * 3600000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const interval = minute >= 9 * 60 && minute < 22 * 60 ? 30 : 120;
  const next = now + interval * 60000;
  // Never carry a night delay across shop opening.
  const opening = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 4);
  return now < opening ? Math.min(next, opening) : next;
}

export function altegioChangeWindow(cursor: string | null, now: Date) {
  const parsed = cursor ? Date.parse(cursor) : NaN;
  return {
    changedBefore: now.toISOString(),
    ...(Number.isFinite(parsed) && parsed <= now.getTime()
      ? { changedAfter: new Date(parsed - 10 * 60000).toISOString() }
      : { startDate: new Date(now.getTime() - 86400000).toISOString().slice(0, 10) }),
    includeDeleted: true,
  };
}

/** A company cursor is valid only for the staff mappings it actually covered. */
export function coveredAltegioChangeWindow(
  cursor: string | null, storedCoverage: string | null, currentCoverage: string, now: Date,
) {
  return altegioChangeWindow(storedCoverage === currentCoverage ? cursor : null, now);
}
