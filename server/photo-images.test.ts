import test from "node:test";
import assert from "node:assert/strict";
import {
  getPhotoThumbnailPath, getPhotoThumbnailUrl, getPhotoImageFallback,
  getPhotoDeletePaths, getPhotoThumbnailDimensions,
} from "../shared/photo-images";

const path = "photos/thumb-v1/12345678-1234-4123-8123-123456789abc/original.jpg";
const base = "https://photos.example.test/storage/v1/object/public/specialist-photos/";

test("successful pair paths and URLs select deterministic siblings, preserving query and hash", () => {
  assert.equal(getPhotoThumbnailPath(path), path.replace("original", "thumbnail"));
  assert.equal(getPhotoThumbnailUrl(base + path + "?cache=1#photo"), base + path.replace("original", "thumbnail") + "?cache=1#photo");
  assert.equal(getPhotoThumbnailPath(path.replace(".jpg", ".png")), path.replace("original.jpg", "thumbnail.png"));
  assert.deepEqual(getPhotoDeletePaths(path), [path, path.replace("original", "thumbnail")]);
});

test("old paths, imported URLs and lookalike paths stay exactly compatible", () => {
  const urls = [
    base + "photos/123456789_photo.jpg",
    "https://altegio.example.test/photo.jpg",
    "https://images.example.test/photos/thumb-v1/12345678-1234-4123-8123-123456789abc/original.jpg",
    base.replace("specialist-photos", "another-bucket") + path,
    base + path.replace("4123", "9123"),
    base + path.replace(".jpg", ".webp"),
    base + path.replace("original", "thumbnail"),
    "", "data:image/png;base64,AAA", "/photos/old.jpg",
  ];
  for (const url of urls) assert.equal(getPhotoThumbnailUrl(url), url);
  assert.deepEqual(getPhotoDeletePaths("photos/123_photo.jpg"), ["photos/123_photo.jpg"]);
  assert.equal(getPhotoThumbnailPath("photos/thumb-v1/../../original.jpg"), null);
});

test("missing thumbnail falls back once; failed original or legacy URL never loops", () => {
  const original = base + path;
  const thumbnail = getPhotoThumbnailUrl(original);
  assert.equal(getPhotoImageFallback(original, thumbnail), original);
  assert.equal(getPhotoImageFallback(original, original), null);
  assert.equal(getPhotoImageFallback(base + "photos/old.jpg", base + "photos/old.jpg"), null);
  assert.equal(getPhotoImageFallback(original, "https://unexpected.example.test/image.jpg"), null);
});

test("inside-fit dimensions stay at most 320, preserve aspect and never upscale", () => {
  assert.deepEqual(getPhotoThumbnailDimensions(1200, 800), { width: 320, height: 213 });
  assert.deepEqual(getPhotoThumbnailDimensions(800, 1200), { width: 213, height: 320 });
  assert.deepEqual(getPhotoThumbnailDimensions(30, 20), { width: 30, height: 20 });
  assert.deepEqual(getPhotoThumbnailDimensions(1, 10000), { width: 1, height: 320 });
  for (const invalid of [0, -1, NaN, Infinity]) assert.throws(() => getPhotoThumbnailDimensions(invalid, 10));
});