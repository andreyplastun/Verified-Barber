import { test } from "node:test";
import assert from "node:assert/strict";
import { createClarityAuthController } from "./clarity-auth";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function fixture() {
  const calls: unknown[][] = [];
  const controller = createClarityAuthController({
    init: () => { calls.push(["init"]); },
    command: (c) => { calls.push([c]); },
    tag: (k, v) => { calls.push(["tag", k, v]); },
    identify: (id) => { calls.push(["identify", id]); },
    restoreTags: () => { calls.push(["restore"]); },
    anonymousId: () => "anonymous",
  });
  return { calls, controller };
}

test("unresolved auth and initial admin never initialize or tag", () => {
  const { calls, controller } = fixture();
  controller.sync(false, null);
  controller.sync(true, { id: "admin-id", role: "admin" });
  assert.deepEqual(calls, []);
  assert.equal(controller.isActive(), false);
});

test("visitor starts once and restores existing tags", () => {
  const { calls, controller } = fixture();
  controller.sync(true, null);
  controller.sync(true, null);
  assert.deepEqual(calls, [["init"], ["tag", "role", "visitor"], ["restore"]]);
});

test("specialist identifies with account ID only", () => {
  const { calls, controller } = fixture();
  controller.sync(true, { id: "account-id", role: "specialist" });
  assert.deepEqual(calls, [["init"], ["tag", "role", "specialist"], ["identify", "account-id"], ["restore"]]);
});

test("login suspends immediately and admin stays stopped", () => {
  const { calls, controller } = fixture();
  controller.sync(true, null);
  calls.length = 0;
  controller.sync(false, null);
  controller.sync(true, { id: "admin-id", role: "admin" });
  controller.sync(true, { id: "admin-id", role: "admin" });
  assert.deepEqual(calls, [["stop"]]);
  assert.equal(controller.isActive(), false);
});

test("logout resets specialist identity and restores visitor tags", () => {
  const { calls, controller } = fixture();
  controller.sync(true, { id: "account-id", role: "specialist" });
  calls.length = 0;
  controller.sync(false, null);
  controller.sync(true, null);
  assert.deepEqual(calls, [["stop"], ["start"], ["tag", "role", "visitor"], ["identify", "anonymous"], ["restore"]]);
});

test("account changes and admin logout are handled", () => {
  const { calls, controller } = fixture();
  controller.sync(true, { id: "admin-id", role: "admin" });
  controller.sync(true, { id: "one", role: "specialist" });
  controller.sync(true, { id: "two", role: "specialist" });
  assert.deepEqual(calls.filter(c => c[0] === "identify"), [["identify", "one"], ["identify", "two"]]);
  assert.equal(calls.filter(c => c[0] === "init").length, 1);
  assert.equal(calls.filter(c => c[0] === "start").length, 1);
});

test("production-compiled integration gates hosts, roles, tags and events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clarity-auth-"));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  try {
    for (const prod of [true, false]) {
      const outfile = join(dir, `${prod}.mjs`);
      await build({
        entryPoints: ["client/src/lib/clarity.ts"], outfile, bundle: true,
        platform: "browser", format: "esm", define: { "import.meta.env.PROD": String(prod) },
      });
      for (const hostname of ["rateus.kz", "www.rateus.kz", "preview.replit.dev", "evilrateus.kz"]) {
        const calls: unknown[][] = [];
        const scripts: unknown[] = [];
        const store = new Map<string, string>();
        const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
        Object.defineProperty(globalThis, "window", { configurable: true, value: {
          location: { hostname, pathname: "/review/test/123", search: "?utm_source=ig&utm_campaign=test" },
          sessionStorage: storage, clarity: (...args: unknown[]) => calls.push(args),
        } });
        Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
        Object.defineProperty(globalThis, "document", { configurable: true, value: {
          getElementById: () => null, createElement: () => ({}),
          getElementsByTagName: () => [{ parentNode: { insertBefore: (s: unknown) => scripts.push(s) } }],
        } });
        const module = await import(`${pathToFileURL(outfile).href}?host=${hostname}`);
        module.initializeClarity();
        module.syncClarityAuth(false, null);
        module.syncClarityAuth(true, { id: "admin-id", role: "admin" });
        module.updateClarityTags();
        module.clarityEvent("create_profile_click");
        assert.equal(scripts.length, 0);
        assert.deepEqual(calls, []);
        module.syncClarityAuth(true, { id: "account-id", role: "specialist" });
        const allowed = prod && ["rateus.kz", "www.rateus.kz"].includes(hostname);
        assert.equal(scripts.length, allowed ? 1 : 0);
        if (!allowed) { assert.deepEqual(calls, []); continue; }
        assert.ok(calls.some(c => c[0] === "identify" && c[1] === "account-id"));
        assert.ok(calls.some(c => c[0] === "set" && c[1] === "role" && c[2] === "specialist"));
        assert.ok(calls.some(c => c[0] === "set" && c[1] === "entry_type" && c[2] === "review_link"));
        assert.ok(calls.some(c => c[0] === "set" && c[1] === "utm_source" && c[2] === "ig"));
        module.clarityEvent("create_profile_click");
        assert.ok(calls.some(c => c[0] === "event" && c[1] === "create_profile_click"));
        calls.length = 0;
        module.syncClarityAuth(false, null);
        module.syncClarityAuth(true, { id: "admin-id", role: "admin" });
        module.updateClarityTags();
        module.clarityEvent("create_profile_click");
        assert.deepEqual(calls, [["stop"]]);
        module.syncClarityAuth(true, null);
        assert.ok(calls.some(c => c[0] === "set" && c[1] === "role" && c[2] === "visitor"));
      }
    }
  } finally {
    for (const [key, descriptor] of [["window", previousWindow], ["document", previousDocument], ["sessionStorage", previousStorage]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await rm(dir, { recursive: true, force: true });
  }
});
