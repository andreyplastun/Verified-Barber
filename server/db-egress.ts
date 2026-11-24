import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const sourceContext = new AsyncLocalStorage<string>();
export const withDbSource = <T>(source: string, fn: () => T): T => sourceContext.run(source, () => {
  const result = fn();
  // Assimilate lazy Drizzle thenables inside the source context.
  return result && typeof (result as any).then === "function" ? Promise.resolve(result) as T : result;
});
type Counter = { queries: number; rows: number; estimatedBytes: number; errors: number };
const empty = (): Counter => ({ queries: 0, rows: 0, estimatedBytes: 0, errors: 0 });

/** Measures returned JSON bytes, NOT Supabase billable wire bytes. Never logs values. */
export class DbEgressMeter {
  private hour = new Map<string, Counter>();
  private day = new Map<string, Counter>();
  private readonly boot = randomUUID();
  private hourStart = Date.now();
  private dayStart = this.hourStart;
  private dayKey = this.localDay(this.hourStart);
  private localDay(t: number) { return new Date(t + 5 * 3600000).toISOString().slice(0, 10); }
  record(source: string, result: any, error?: unknown) {
    const results = Array.isArray(result) ? result : [result];
    let rows = 0, bytes = 0;
    for (const r of results) {
      if (!r?.rows) continue;
      rows += r.rows.length;
      bytes += Buffer.byteLength(JSON.stringify(r.rows, (_k, v) => typeof v === "bigint" ? v.toString() : v));
    }
    for (const map of [this.hour, this.day]) {
      const c = map.get(source) ?? empty();
      c.queries++; c.rows += rows; c.estimatedBytes += bytes; c.errors += error ? 1 : 0;
      map.set(source, c);
    }
  }
  snapshot() { return Object.fromEntries(this.day); }
  flush(now = Date.now(), log = console.log) {
    const emit = (period: string, from: number, map: Map<string, Counter>) =>
      log(JSON.stringify({ event: "db_egress", period, boot: this.boot, from: new Date(from).toISOString(),
        to: new Date(now).toISOString(), measurement: "returned_json_bytes_not_wire", sources: Object.fromEntries(map) }));
    if (now - this.hourStart >= 3600000) {
      emit("hour", this.hourStart, this.hour); this.hour.clear(); this.hourStart = now;
    }
    if (this.localDay(now) !== this.dayKey) {
      emit("day_partial_since_start", this.dayStart, this.day);
      this.day.clear(); this.dayStart = now; this.dayKey = this.localDay(now);
    }
  }
}

export const dbEgress = new DbEgressMeter();
const attached = new WeakSet<object>();
/** Instrument client.query only: Pool.query delegates to it, so no double counting. */
export function instrumentDbClient(client: PoolClient, meter = dbEgress) {
  if (attached.has(client)) return;
  attached.add(client);
  const original = client.query;
  client.query = function (this: PoolClient, ...args: any[]) {
    const source = sourceContext.getStore() ?? "unattributed";
    let counted = false;
    const record = (result: unknown, error?: unknown) => {
      if (counted) return;
      counted = true;
      try { meter.record(source, result, error); } catch { /* instrumentation must not break SQL */ }
    };
    const callbackIndex = args.length - 1;
    if (typeof args[callbackIndex] === "function") {
      const callback = args[callbackIndex];
      args[callbackIndex] = (err: unknown, result: unknown) => { record(result, err); callback(err, result); };
    }
    try {
      const result: any = (original as any).apply(this, args);
      if (result && typeof (result as any).then === "function")
        return (result as any).then((r: unknown) => { record(r); return r; }, (e: unknown) => { record(null, e); throw e; });
      return result;
    } catch (e) { record(null, e); throw e; }
  } as PoolClient["query"];
}
export function instrumentDbPool(pool: Pool, meter = dbEgress) {
  const connect = pool.connect;
  // pg-pool can service a queued request in the previous borrower's async context.
  pool.connect = function (this: Pool, callback?: any): any {
    return callback ? (connect as any).call(this, AsyncResource.bind(callback)) : (connect as any).call(this);
  } as Pool["connect"];
  pool.on("connect", client => instrumentDbClient(client, meter));
}
export function startDbMeter(pool: Pool) {
  instrumentDbPool(pool);
  const timer = setInterval(() => dbEgress.flush(), 60000);
  timer.unref();
}
