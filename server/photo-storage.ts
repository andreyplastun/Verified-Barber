import { randomUUID } from "node:crypto";
import {
  getPhotoThumbnailPath,
  PHOTO_IMMUTABLE_CACHE_SECONDS,
  PHOTO_THUMBNAIL_MAX_BYTES,
} from "../shared/photo-images";
import { getPhotoStoragePaths } from "../shared/photo-variants";

export const PHOTO_BUCKET_NAME = "specialist-photos";

export type PhotoDerivative = { file: Buffer; contentType: string };
export type PhotoUploadResult = { url: string; path: string; warning?: string };
type StorageError = { message: string } | null;

// A small injectable interface keeps orchestration tests independent of client
// credentials, database modules, real storage and startup side effects.
export interface PhotoBucket {
  upload(path: string, file: Buffer, options: { contentType: string; upsert: boolean; cacheControl?: string }): PromiseLike<{ error: StorageError }>;
  remove(paths: string[]): PromiseLike<{ error: StorageError }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

export function validatePhotoDerivative(derivative: PhotoDerivative, originalContentType: string): string | null {
  if (!["image/jpeg", "image/png"].includes(derivative.contentType) || derivative.contentType !== originalContentType) {
    return "Thumbnail must have the same JPG or PNG format as the original";
  }
  if (derivative.file.length === 0 || derivative.file.length > PHOTO_THUMBNAIL_MAX_BYTES) {
    return "Thumbnail must be nonempty and at most 256KB";
  }
  // Do not trust a multipart MIME label alone. Check the supported signatures.
  const isPng = derivative.file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = derivative.file[0] === 0xff && derivative.file[1] === 0xd8 && derivative.file[2] === 0xff;
  if (derivative.contentType === "image/png" ? !isPng : !isJpeg) {
    return "Thumbnail bytes do not match its image format";
  }
  return null;
}

export async function storePhoto(
  bucket: PhotoBucket,
  file: Buffer,
  fileName: string,
  contentType: string,
  derivative?: PhotoDerivative,
): Promise<PhotoUploadResult> {
  let path = `photos/${Date.now()}_${fileName}`;
  let thumbnailPath: string | null = null;
  let warning: string | undefined;
  if (derivative) {
    const invalid = validatePhotoDerivative(derivative, contentType);
    if (invalid) throw new Error(invalid);
    const extension = contentType === "image/png" ? "png" : "jpg";
    const pairOriginal = `photos/thumb-v1/${randomUUID()}/original.${extension}`;
    const pairThumbnail = getPhotoThumbnailPath(pairOriginal)!;
    // Upload the derivative first: never return the pair convention if it is
    // missing. A failure saves only the untouched original under a legacy path.
    try {
      const { error } = await bucket.upload(pairThumbnail, derivative.file, {
        contentType: derivative.contentType, upsert: false, cacheControl: PHOTO_IMMUTABLE_CACHE_SECONDS,
      });
      if (error) throw new Error(error.message);
      path = pairOriginal;
      thumbnailPath = pairThumbnail;
    } catch (error) {
      warning = `Thumbnail upload failed; original photo saved without optimization: ${error instanceof Error ? error.message : String(error)}`;
      // A network error can arrive after the object was actually written.
      try {
        const { error: cleanupError } = await bucket.remove([pairThumbnail]);
        if (cleanupError) console.error("[PHOTO STORAGE] Failed thumbnail cleanup:", cleanupError.message);
      } catch (cleanupError) {
        console.error("[PHOTO STORAGE] Failed thumbnail cleanup:", cleanupError);
      }
      // Unique, safe, non-pair name ensures clients use the original directly.
      path = `photos/${randomUUID()}_original.${extension}`;
    }
  }

  try {
    const { error } = await bucket.upload(path, file, {
      contentType, upsert: false,
      ...(derivative ? { cacheControl: PHOTO_IMMUTABLE_CACHE_SECONDS } : {}),
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    if (thumbnailPath) {
      try {
        const { error: cleanupError } = await bucket.remove([thumbnailPath]);
        if (cleanupError) console.error("[PHOTO STORAGE] Thumbnail cleanup failed:", cleanupError.message);
      } catch (cleanupError) {
        console.error("[PHOTO STORAGE] Thumbnail cleanup failed:", cleanupError);
      }
    }
    throw error;
  }
  const { data } = bucket.getPublicUrl(path);
  return { url: data.publicUrl, path, ...(warning ? { warning } : {}) };
}

export async function removePhoto(bucket: PhotoBucket, path: string): Promise<void> {
  const { error } = await bucket.remove(getPhotoStoragePaths(path));
  if (error) throw new Error(error.message);
}