export type BrowserLocation = { latitude: number; longitude: number; accuracy: number; capturedAt: number };
export type GeoStatus = "success" | "unsupported" | "insecure" | "denied" | "timeout" | "unavailable" | "skipped";
export type GeoResult = { status: GeoStatus; location?: BrowserLocation };

/** Call directly from the optional location button's click handler, never on page load. */
export function getFreshBrowserLocation(
  secure: boolean,
  geolocation: Geolocation | undefined,
): Promise<GeoResult> {
  if (!secure) return Promise.resolve({ status: "insecure" });
  if (!geolocation) return Promise.resolve({ status: "unsupported" });
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        (position) => resolve({
          status: "success",
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: position.timestamp,
          },
        }),
        (error) => resolve({
          status: error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable",
        }),
        { maximumAge: 0, timeout: 10_000, enableHighAccuracy: true },
      );
    } catch {
      resolve({ status: "unavailable" });
    }
  });
}