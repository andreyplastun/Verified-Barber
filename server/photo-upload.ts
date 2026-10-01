import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPhotoPreview } from "./photo-processing";

type PhotoBucket = Pick<ReturnType<SupabaseClient["storage"]["from"]>, "upload" | "getPublicUrl">;

/**
 * No network reads, transformations service or schema migration. All new keys
 * are immutable; only advertise the versioned path when both files exist.
 * No objects (including originals) are removed if a later write fails.
 */
export async function uploadSpecialistPhoto(
  bucket: PhotoBucket,
  file: Buffer,
  contentType: string,
): Promise<{ url: string; path: string } | null> {
  const { preview, extension } = await createPhotoPreview(file, contentType);
  const directory = `photos/preview-v1/${randomUUID()}`;
  const path = `${directory}/original.${extension}`;
  const options = { contentType, cacheControl: "31536000", upsert: false };

  for (const [key, bytes] of [
    [`${directory}/preview.${extension}`, preview],
    [path, file],
  ] as const) {
    const { error } = await bucket.upload(key, bytes, options);
    if (error) {
      console.error("[SUPABASE STORAGE] Photo upload failed:", error.message);
      return null;
    }
  }
  return { url: bucket.getPublicUrl(path).data.publicUrl, path };
}