import test from "node:test";
import assert from "node:assert/strict";
import { storePhoto, removePhoto, validatePhotoDerivative, type PhotoBucket } from "./photo-storage";
import { getPhotoThumbnailPath, getPhotoDeletePaths, PHOTO_IMMUTABLE_CACHE_SECONDS, PHOTO_THUMBNAIL_MAX_BYTES } from "../shared/photo-images";

const original = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const derivative = { file: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 0xff, 0xd9]), contentType: "image/jpeg" };

function fakeBucket(fail?: "thumbnail" | "original" | "delete", throwThumbnail = false) {
  const uploads: { path: string; file: Buffer; options: Parameters<PhotoBucket["upload"]>[2] }[] = [];
  const removals: string[][] = [];
  const bucket: PhotoBucket = {
    async upload(path, file, options) {
      uploads.push({ path, file, options });
      if (throwThumbnail && path.includes("/thumbnail.")) throw new Error("Test network failure");
      const shouldFail = (fail === "thumbnail" && path.includes("/thumbnail.")) ||
        (fail === "original" && path.includes("/original."));
      return { error: shouldFail ? { message: `Test ${fail} failure` } : null };
    },
    async remove(paths) {
      removals.push(paths);
      return { error: fail === "delete" ? { message: "Test delete failure" } : null };
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://photos.example.test/storage/v1/object/public/specialist-photos/${path}` } };
    },
  };
  return { bucket, uploads, removals };
}

test("pair upload retains original bytes, safe unique paths and explicit immutable cache", async () => {
  const fake = fakeBucket();
  const before = Buffer.from(original);
  const result = await storePhoto(fake.bucket, original, "../../unsanitized.jpg", "image/jpeg", derivative);
  assert.equal(result.warning, undefined);
  assert.equal(fake.uploads.length, 2);
  assert.equal(fake.uploads[0].path, getPhotoThumbnailPath(result.path));
  assert.equal(fake.uploads[1].path, result.path);
  assert.equal(fake.uploads[1].file, original);
  assert.deepEqual(original, before);
  assert.deepEqual(fake.uploads[1].file, before);
  for (const upload of fake.uploads) {
    assert.equal(upload.options.upsert, false);
    assert.equal(upload.options.cacheControl, PHOTO_IMMUTABLE_CACHE_SECONDS);
    assert.equal(upload.path.includes("unsanitized"), false);
  }
  assert.ok(result.url.endsWith(result.path));
  const another = await storePhoto(fake.bucket, original, "same.jpg", "image/jpeg", derivative);
  assert.notEqual(another.path, result.path);
});

test("legacy callers retain legacy original-only convention and options", async () => {
  const fake = fakeBucket();
  const result = await storePhoto(fake.bucket, original, "old.jpg", "image/jpeg");
  assert.match(result.path, /^photos\/\d+_old\.jpg$/);
  assert.equal(getPhotoThumbnailPath(result.path), null);
  assert.equal(fake.uploads.length, 1);
  assert.deepEqual(fake.uploads[0].options, { contentType: "image/jpeg", upsert: false });
  assert.equal(fake.uploads[0].file, original);
  assert.equal(result.warning, undefined);
});

test("thumbnail failure or exception explicitly warns and never advertises the pair convention", async () => {
  for (const throws of [false, true]) {
    const fake = fakeBucket("thumbnail", throws);
    const result = await storePhoto(fake.bucket, original, "new.jpg", "image/jpeg", derivative);
    assert.match(result.warning || "", /original photo saved without optimization/);
    assert.equal(getPhotoThumbnailPath(result.path), null);
    assert.equal(fake.uploads[1].file, original);
    assert.deepEqual(getPhotoDeletePaths(result.path), [result.path]);
    assert.deepEqual(fake.removals, [[fake.uploads[0].path]]);
  }
});

test("PNG pair retains both PNG formats and deterministic matching sibling", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const fake = fakeBucket();
  const result = await storePhoto(fake.bucket, png, "image.png", "image/png", { file: png, contentType: "image/png" });
  assert.ok(result.path.endsWith("/original.png"));
  assert.ok(fake.uploads[0].path.endsWith("/thumbnail.png"));
  assert.equal(fake.uploads[0].options.contentType, "image/png");
  assert.equal(fake.uploads[1].file, png);
});

test("original failure removes only the newly uploaded derivative and returns an error", async () => {
  const fake = fakeBucket("original");
  await assert.rejects(storePhoto(fake.bucket, original, "new.jpg", "image/jpeg", derivative), /original failure/);
  assert.deepEqual(fake.removals, [[fake.uploads[0].path]]);
});

test("new deletion removes original and sibling; old deletion is unchanged and errors are surfaced", async () => {
  const fake = fakeBucket();
  const result = await storePhoto(fake.bucket, original, "new.jpg", "image/jpeg", derivative);
  await removePhoto(fake.bucket, result.path);
  await removePhoto(fake.bucket, "photos/old.jpg");
  assert.deepEqual(fake.removals, [getPhotoDeletePaths(result.path), ["photos/old.jpg"]]);
  await assert.rejects(removePhoto(fakeBucket("delete").bucket, result.path), /delete failure/);
});

test("derivative MIME, signature and 256KB bound are checked before any writes", async () => {
  const png = { file: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]), contentType: "image/png" };
  assert.equal(validatePhotoDerivative(derivative, "image/jpeg"), null);
  assert.equal(validatePhotoDerivative(png, "image/png"), null);
  const invalid = [
    { ...derivative, contentType: "image/gif" },
    { ...derivative, file: Buffer.alloc(0) },
    { ...derivative, file: Buffer.alloc(PHOTO_THUMBNAIL_MAX_BYTES + 1) },
    { ...derivative, file: Buffer.from("not an image") },
    png,
  ];
  for (const thumbnail of invalid) {
    const fake = fakeBucket();
    assert.ok(validatePhotoDerivative(thumbnail, "image/jpeg"));
    await assert.rejects(storePhoto(fake.bucket, original, "new.jpg", "image/jpeg", thumbnail));
    assert.equal(fake.uploads.length, 0);
  }
});

test("explicit deletion also cleans server-generated preview-v1 companions", async () => {
  const fake = fakeBucket();
  const path = "photos/preview-v1/12345678-1234-4123-8123-123456789abc/original.png";
  await removePhoto(fake.bucket, path);
  assert.deepEqual(fake.removals, [[path, path.replace("/original.", "/preview.")]]);
});