import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createPhotoPreview, InvalidPhotoError, PhotoProcessingBusyError } from "./photo-processing";
import { uploadSpecialistPhoto } from "./photo-upload";
import { getPhotoPreviewPath, getPhotoPreviewUrl, getPhotoStoragePaths } from "../shared/photo-variants";

const directory = "photos/preview-v1/00000000-0000-4000-8000-000000000000";
const root = "https://storage.example/storage/v1/object/public/specialist-photos/";
const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

// Reproducible real encoded files; no storage credentials/network/DB needed.
async function fixture(format: "jpeg" | "png", width = 1600, height = 1000) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 123456;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  const image = sharp(pixels, { raw: { width, height, channels: 3 } });
  return format === "jpeg" ? image.jpeg({ quality: 95 }).toBuffer() : image.png().toBuffer();
}

for (const format of ["jpeg", "png"] as const) {
  test(`${format}: bounded preview saves bytes and leaves original untouched`, async () => {
    const original = await fixture(format);
    const before = hash(original);
    const { preview } = await createPhotoPreview(original, `image/${format}`);
    const meta = await sharp(preview).metadata();
    assert.equal(meta.width, 480);
    assert.equal(meta.height, 300);
    assert.equal(meta.format, format);
    assert.equal(hash(original), before);
    assert.ok(preview.length < original.length / 4);
    console.log(`${format}: original=${original.length} preview=${preview.length} bytes; reduction=${(100 * (1 - preview.length / original.length)).toFixed(1)}%`);
  });
}

test("preview honors EXIF orientation and strips metadata", async () => {
  const original = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "red" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const { preview } = await createPhotoPreview(original, "image/jpeg");
  const meta = await sharp(preview).metadata();
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 480);
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.exif, undefined);
});

test("small transparent PNG stays transparent and is not enlarged", async () => {
  const original = await sharp({
    create: { width: 40, height: 20, channels: 4, background: { r: 200, g: 50, b: 20, alpha: 0.25 } },
  }).png().toBuffer();
  const { preview } = await createPhotoPreview(original, "image/png");
  const meta = await sharp(preview).metadata();
  assert.equal(meta.width, 40);
  assert.equal(meta.height, 20);
  assert.equal(meta.hasAlpha, true);
  const { data } = await sharp(preview).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[3] > 0 && data[3] < 255);
});

test("rejects fake, empty, oversized, mismatched and truncated images", async () => {
  const jpeg = await fixture("jpeg", 100, 100);
  for (const [file, type] of [
    [Buffer.from("<svg/>"), "image/jpeg"],
    [Buffer.alloc(0), "image/png"],
    [Buffer.alloc(5 * 1024 * 1024 + 1), "image/jpeg"],
    [jpeg, "image/png"],
    [jpeg, "text/plain"],
    [jpeg.subarray(0, jpeg.length / 2), "image/jpeg"],
  ] as const) {
    await assert.rejects(createPhotoPreview(file, type), InvalidPhotoError);
  }
});

test("rejects decompression bombs before resizing", async () => {
  const original = await sharp({
    create: { width: 6400, height: 6400, channels: 3, background: "white" },
  }).png().toBuffer();
  assert.ok(original.length < 5 * 1024 * 1024);
  await assert.rejects(createPhotoPreview(original, "image/png"), InvalidPhotoError);
});

test("bounds concurrent decodes and frees capacity after errors", async () => {
  const original = await fixture("jpeg", 1000, 1000);
  const first = createPhotoPreview(original, "image/jpeg");
  const second = createPhotoPreview(original, "image/jpeg");
  await assert.rejects(createPhotoPreview(original, "image/jpeg"), PhotoProcessingBusyError);
  await Promise.all([first, second]);
  await assert.rejects(createPhotoPreview(Buffer.from("invalid"), "image/png"), InvalidPhotoError);
  await createPhotoPreview(original, "image/jpeg");
});

test("only new public specialist photo URLs resolve to previews", () => {
  const original = `${root}${directory}/original.jpg`;
  assert.equal(getPhotoPreviewUrl(original), `${root}${directory}/preview.jpg`);
  assert.equal(getPhotoPreviewUrl(original + "?download=1"), `${root}${directory}/preview.jpg?download=1`);
  assert.equal(getPhotoPreviewPath(`${directory}/original.png`), `${directory}/preview.png`);
  for (const url of [
    `${root}photos/17000000_original.jpg`,
    "https://assets.alteg.io/masters/photo.jpg",
    "/placeholder.png", "", "invalid",
    `https://storage.example/storage/v1/object/sign/specialist-photos/${directory}/original.jpg?token=test`,
    `https://storage.example/storage/v1/object/public/other/${directory}/original.jpg`,
  ]) assert.equal(getPhotoPreviewUrl(url), url);
});

test("explicit delete includes companion only for new uploads", () => {
  assert.deepEqual(getPhotoStoragePaths(`${directory}/original.jpg`), [
    `${directory}/original.jpg`, `${directory}/preview.jpg`,
  ]);
  assert.deepEqual(getPhotoStoragePaths("photos/legacy.jpg"), ["photos/legacy.jpg"]);
});

test("incoming thumb-v1 originals retain their existing thumbnails and deletion pairs", () => {
  const path = "photos/thumb-v1/12345678-1234-4123-8123-123456789abc/original.jpg";
  assert.equal(getPhotoPreviewUrl(root + path), root + path.replace("/original.", "/thumbnail."));
  assert.deepEqual(getPhotoStoragePaths(path), [path, path.replace("/original.", "/thumbnail.")]);
});

function fakeBucket(failAt = -1) {
  const writes: { path: string; buffer: Buffer; options: any }[] = [];
  return {
    writes,
    bucket: {
      async upload(path: string, buffer: Buffer, options: any) {
        writes.push({ path, buffer, options });
        return { data: null, error: writes.length === failAt ? { message: "test write failure" } : null };
      },
      getPublicUrl(path: string) { return { data: { publicUrl: root + path } }; },
    } as unknown as Parameters<typeof uploadSpecialistPhoto>[0],
  };
}

test("upload writes preview first, caches immutable keys and returns exact original", async () => {
  const original = await fixture("jpeg", 800, 600);
  const { bucket, writes } = fakeBucket();
  const result = await uploadSpecialistPhoto(bucket, original, "image/jpeg");
  assert.ok(result);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, getPhotoPreviewPath(result.path));
  assert.equal(writes[1].path, result.path);
  assert.equal(hash(writes[1].buffer), hash(original));
  for (const write of writes) {
    assert.equal(write.options.cacheControl, "31536000");
    assert.equal(write.options.upsert, false);
    assert.equal(write.options.contentType, "image/jpeg");
  }
  assert.equal(result.url, root + result.path);
  const second = await uploadSpecialistPhoto(bucket, original, "image/jpeg");
  assert.notEqual(second?.path, result.path);
});

test("storage/validation failures never advertise a broken preview or delete originals", async () => {
  const original = await fixture("png", 40, 30);
  for (const failAt of [1, 2]) {
    const { bucket, writes } = fakeBucket(failAt);
    assert.equal(await uploadSpecialistPhoto(bucket, original, "image/png"), null);
    assert.equal(writes.length, failAt);
  }
  const { bucket, writes } = fakeBucket();
  await assert.rejects(uploadSpecialistPhoto(bucket, Buffer.from("bad"), "image/png"), InvalidPhotoError);
  assert.equal(writes.length, 0);
});