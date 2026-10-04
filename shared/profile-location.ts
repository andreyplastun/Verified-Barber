type LocationFields = {
  workAddress?: string | null;
  workLat?: number | string | null;
  workLng?: number | string | null;
};

// Sending the current location is not a move and must not consume its cooldown.
export function hasWorkLocationChanged(current: LocationFields, patch: LocationFields): boolean {
  const coordinate = (value: number | string | null | undefined) =>
    value == null ? null : Number(value);
  return (
    (patch.workAddress !== undefined &&
      (patch.workAddress || "").trim() !== (current.workAddress || "").trim()) ||
    (patch.workLat !== undefined && coordinate(patch.workLat) !== coordinate(current.workLat)) ||
    (patch.workLng !== undefined && coordinate(patch.workLng) !== coordinate(current.workLng))
  );
}