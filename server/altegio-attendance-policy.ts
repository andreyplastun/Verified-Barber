export function getAltegioInvalidatedBookingStatus(
  currentStatus: string,
  attendance: number | string | null | undefined,
  deleted = false,
): "cancelled" | null {
  if (deleted) return "cancelled";
  if (attendance === null || attendance === undefined || attendance === "") return null;
  const normalizedAttendance = Number(attendance);
  if (!Number.isFinite(normalizedAttendance)) return null;
  if (normalizedAttendance === -1) return "cancelled";
  if (currentStatus === "completed" && normalizedAttendance !== 1) return "cancelled";
  return null;
}