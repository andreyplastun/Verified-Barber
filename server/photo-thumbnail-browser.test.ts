import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { build } from "esbuild";

async function runFixture(chromium: string, directory: string, html: string): Promise<string> {
  // Real-time CDP evaluation awaits the canvas encoder. --dump-dom's virtual
  // time can finish before off-thread image decoding, yielding a false pending.
  const browser = spawn(chromium, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
    "--disable-component-update", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(directory, "profile")}`, "--remote-debugging-pipe",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const input = browser.stdio[3] as Writable;
  const output = browser.stdio[4] as Readable;
  let nextId = 0;
  let buffered = "";
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const events = new Map<string, () => void>();
  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  };
  output.on("data", chunk => {
    buffered += chunk.toString();
    let delimiter;
    while ((delimiter = buffered.indexOf("\0")) !== -1) {
      const message = JSON.parse(buffered.slice(0, delimiter));
      buffered = buffered.slice(delimiter + 1);
      if (message.id) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error.message));
        else request?.resolve(message.result);
      } else {
        events.get(`${message.sessionId}:${message.method}`)?.();
      }
    }
  });
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) request.reject(error);
  };
  browser.on("error", rejectPending);
  browser.on("exit", () => rejectPending(new Error("Fixture browser exited")));
  const deadline = setTimeout(() => {
    rejectPending(new Error("Fixture browser timed out"));
    browser.kill();
  }, 70000);
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    const loaded = new Promise<void>(resolve => events.set(`${sessionId}:Page.loadEventFired`, resolve));
    await send("Page.navigate", { url: `file://${html}` }, sessionId);
    await loaded;
    const result = await send("Runtime.evaluate", {
      expression: "window.photoFixtureResult.then(() => document.body.textContent)",
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } finally {
    try {
      await send("Browser.close");
    } catch {
      browser.kill();
    }
    clearTimeout(deadline);
    // Wait before deleting its temporary profile to avoid racing browser IO.
    if (browser.exitCode === null && browser.signalCode === null) {
      await new Promise<void>(resolve => browser.once("exit", () => resolve()));
    }
  }
}

// This isolated browser harness loads only a local file and generated fixtures.
// It does not start the app, use credentials, access APIs or download images.
test("browser canvas: generated JPEG/PNG shrink, original multipart bytes, EXIF, no upsize and explicit fallback", { timeout: 90000 }, async t => {
  const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
  try {
    await access(chromium);
  } catch {
    t.skip("Chromium unavailable; set CHROMIUM_PATH to run the browser-only fixture test");
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "photo-thumbnail-fixtures-"));
  try {
    const harness = `
      import { createPhotoThumbnail, createPhotoUploadForm } from "./client/src/lib/photo-thumbnail";
      const check = (condition, label) => { if (!condition) throw new Error(label); };
      const encode = (canvas, mime, quality) => new Promise(resolve => canvas.toBlob(resolve, mime, quality));
      const dimensions = async blob => {
        const bitmap = await createImageBitmap(blob);
        const result = [bitmap.width, bitmap.height];
        bitmap.close();
        return result;
      };
      const sameBytes = async (a, b) => {
        const left = new Uint8Array(await a.arrayBuffer());
        const right = new Uint8Array(await b.arrayBuffer());
        return left.length === right.length && left.every((value, index) => value === right[index]);
      };
      const canvas = (width, height) => {
        const result = document.createElement("canvas");
        result.width = width; result.height = height;
        return result;
      };
      window.photoFixtureResult = (async () => {
        const metrics = [];
        const fixture = canvas(1200, 800);
        const context = fixture.getContext("2d");
        const pixels = context.createImageData(1200, 800);
        let seed = 12345;
        for (let index = 0; index < pixels.data.length; index += 4) {
          for (let channel = 0; channel < 3; channel++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            pixels.data[index + channel] = seed >>> 24;
          }
          pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        for (const mime of ["image/jpeg", "image/png"]) {
          const original = await encode(fixture, mime, 0.95);
          const file = new File([original], "fixture." + (mime === "image/png" ? "png" : "jpg"), { type: mime });
          const before = new Blob([await file.arrayBuffer()], { type: mime });
          const result = await createPhotoUploadForm(file, "work");
          check(!result.warning, "unexpected thumbnail warning");
          const thumbnail = result.formData.get("thumbnail");
          check(thumbnail instanceof Blob, "missing derivative");
          check(thumbnail.type === mime, "thumbnail mime changed");
          check(thumbnail.size < file.size / 5, "insufficient byte reduction");
          check(thumbnail.size <= 256 * 1024, "thumbnail exceeds limit");
          check(JSON.stringify(await dimensions(thumbnail)) === "[320,213]", "incorrect inside-fit dimensions");
          check(result.formData.get("photo") === file, "original File identity replaced");
          check(await sameBytes(result.formData.get("photo"), before), "original bytes changed");
          check(result.formData.get("photoType") === "work", "multipart type missing");
          metrics.push({ mime, originalBytes: file.size, thumbnailBytes: thumbnail.size, dimensions: [320, 213] });
        }
        const square = canvas(800, 800);
        square.getContext("2d").drawImage(fixture, 0, 0, 800, 800, 0, 0, 800, 800);
        const squareFile = new File([await encode(square, "image/png")], "square.png", { type: "image/png" });
        const boundedPng = await createPhotoThumbnail(squareFile);
        check(boundedPng.size <= 256 * 1024, "detailed PNG exceeds byte bound");
        check(JSON.stringify(await dimensions(boundedPng)) === "[256,256]", "detailed PNG smaller-edge retry missing");
        metrics.push({ mime: "image/png (detailed square)", originalBytes: squareFile.size, thumbnailBytes: boundedPng.size, dimensions: [256, 256] });
        const small = canvas(64, 40);
        const smallContext = small.getContext("2d");
        smallContext.fillStyle = "rgba(255,0,0,0.25)"; smallContext.fillRect(0, 0, 64, 40);
        const smallFile = new File([await encode(small, "image/png")], "small.png", { type: "image/png" });
        const smallThumb = await createPhotoThumbnail(smallFile);
        check(JSON.stringify(await dimensions(smallThumb)) === "[64,40]", "small image upscaled");
        const alphaBitmap = await createImageBitmap(smallThumb);
        const alphaCanvas = canvas(64, 40);
        alphaCanvas.getContext("2d").drawImage(alphaBitmap, 0, 0);
        const alpha = alphaCanvas.getContext("2d").getImageData(10, 10, 1, 1).data[3];
        alphaBitmap.close();
        check(alpha >= 62 && alpha <= 65, "PNG transparency lost");
        const oriented = canvas(1200, 800);
        const oc = oriented.getContext("2d");
        for (const [color, x, y] of [["red",0,0],["blue",600,0],["green",0,400],["yellow",600,400]]) {
          oc.fillStyle = color; oc.fillRect(x, y, 600, 400);
        }
        const jpeg = new Uint8Array(await (await encode(oriented, "image/jpeg", 0.95)).arrayBuffer());
        const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
        const orientationFile = new File([jpeg.slice(0,2), exif, jpeg.slice(2)], "oriented.jpg", { type: "image/jpeg" });
        const bitmapDecoder = window.createImageBitmap;
        for (const fallbackDecoder of [false, true]) {
          if (fallbackDecoder) window.createImageBitmap = undefined;
          let thumb;
          try { thumb = await createPhotoThumbnail(orientationFile); }
          finally { window.createImageBitmap = bitmapDecoder; }
          check(JSON.stringify(await dimensions(thumb)) === "[213,320]", "EXIF orientation dimensions incorrect");
          const orientedBitmap = await createImageBitmap(thumb);
          const sample = canvas(213, 320);
          sample.getContext("2d").drawImage(orientedBitmap, 0, 0);
          const color = sample.getContext("2d").getImageData(160, 80, 1, 1).data;
          orientedBitmap.close();
          check(color[0] > 230 && color[1] < 30 && color[2] < 30, "EXIF visual rotation incorrect");
        }
        const invalid = new File(["invalid bytes"], "bad.jpg", { type: "image/jpeg" });
        const failed = await createPhotoUploadForm(invalid, "avatar");
        check(!!failed.warning, "decode failure silently ignored");
        check(!failed.formData.has("thumbnail"), "failed derivative advertised");
        check(failed.formData.get("photo") === invalid, "fallback original replaced");
        document.body.textContent = "PHOTO_FIXTURE_PASS " + JSON.stringify(metrics);
      })().catch(error => { document.body.textContent = "PHOTO_FIXTURE_FAIL " + error.message; });
    `;
    const output = await build({
      stdin: { contents: harness, resolveDir: process.cwd(), loader: "ts" },
      bundle: true, write: false, format: "iife", platform: "browser",
    });
    const html = join(directory, "fixtures.html");
    await writeFile(html, `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'"><body>PHOTO_FIXTURE_PENDING<script>${output.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body>`);
    const text = await runFixture(chromium, directory, html);
    const result = text.match(/^PHOTO_FIXTURE_PASS (\[.+\])$/);
    assert.ok(result, text || "Browser produced no fixture result");
    const metrics = JSON.parse(result[1]);
    for (const metric of metrics) t.diagnostic(JSON.stringify(metric));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});