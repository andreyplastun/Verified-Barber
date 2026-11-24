/** Fail the entire cycle on pagination errors; caller must not advance its cursor. */
export async function collectChangedAppointments<T extends { id: number; datetime: string }>(
  fetchPage: (page: number, count: number) => Promise<{success: boolean; appointments?: T[]; total?: number; error?: string}>,
  count = 200,
): Promise<T[]> {
  const rows = new Map<number, T>();
  let received = 0;
  for (let page = 1; page <= 500; page++) {
    const result = await fetchPage(page, count);
    if (!result.success || !result.appointments) throw new Error(`page ${page}: ${result.error || "missing_data"}`);
    received += result.appointments.length;
    for (const row of result.appointments) rows.set(row.id, row);
    if (result.appointments.length < count || (result.total != null && received >= result.total))
      return [...rows.values()].sort((a,b) => Date.parse(a.datetime)-Date.parse(b.datetime));
  }
  throw new Error("pagination safety limit");
}
