import assert from "node:assert/strict";
import test from "node:test";
import { getFreshBrowserLocation } from "./manualPresenceLocation";

test("location is only requested by explicit call, synchronously and without cached readings", async () => {
  let called = false;
  const geo = {
    getCurrentPosition(success: PositionCallback, _error: PositionErrorCallback, options: PositionOptions) {
      called = true;
      assert.deepEqual(options, { maximumAge: 0, timeout: 10_000, enableHighAccuracy: true });
      success({ coords: { latitude: 43, longitude: 76, accuracy: 10 }, timestamp: 123 } as GeolocationPosition);
    },
  } as Geolocation;
  assert.equal(called, false);
  const result = getFreshBrowserLocation(true, geo);
  assert.equal(called, true); // before any await
  assert.deepEqual(await result, {
    status: "success", location: { latitude: 43, longitude: 76, accuracy: 10, capturedAt: 123 },
  });
});

test("insecure, unsupported, denied, timeout, unavailable and thrown errors are bounded codes", async () => {
  const geo = (code: number): Geolocation => ({
    getCurrentPosition(_success: PositionCallback, error: PositionErrorCallback) {
      error({ code } as GeolocationPositionError);
    },
  } as Geolocation);
  assert.deepEqual(await getFreshBrowserLocation(false, geo(1)), { status: "insecure" });
  assert.deepEqual(await getFreshBrowserLocation(true, undefined), { status: "unsupported" });
  for (const [code, status] of [[1, "denied"], [2, "unavailable"], [3, "timeout"], [100, "unavailable"]] as const) {
    assert.deepEqual(await getFreshBrowserLocation(true, geo(code)), { status });
  }
  assert.deepEqual(await getFreshBrowserLocation(true, {
    getCurrentPosition() { throw new Error("do not surface browser detail"); },
  } as unknown as Geolocation), { status: "unavailable" });
});