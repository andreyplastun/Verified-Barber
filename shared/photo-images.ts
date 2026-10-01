// Only successful original/thumbnail pairs use this versioned, immutable layout.
// Legacy Supabase, Altegio and external image URLs must be left untouched.
export const PHOTO_THUMBNAIL_MAX_EDGE = 320;
export const PHOTO_THUMBNAIL_MAX_BYTES = 256 * 1024;
export const PHOTO_IMMUTABLE_CACHE_SECONDS = "31536000";

const pairPath = /^photos\/thumb-v1\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/original\.(jpg|png)$/;

export function getPhotoThumbnailPath(originalPath: string): string | null {
  return pairPath.test(originalPath)
    ? originalPath.replace(/\/original\.(jpg|png)$/, "/thumbnail.$1")
    : null;
}

export function getPhotoDeletePaths(originalPath: string): string[] {
  const thumbnailPath = getPhotoThumbnailPath(originalPath);
  return thumbnailPath ? [originalPath, thumbnailPath] : [originalPath];
}

export function getPhotoThumbnailUrl(originalUrl: string): string {
  const match = originalUrl.match(/^(https?:\/\/[^/?#]+\/storage\/v1\/object\/public\/specialist-photos\/)([^?#]+)([?#].*)?$/);
  if (!match) return originalUrl;
  const thumbnailPath = getPhotoThumbnailPath(match[2]);
  return thumbnailPath ? `${match[1]}${thumbnailPath}${match[3] || ""}` : originalUrl;
}

// A missing derivative can retry the original once; an original failure cannot
// retry either URL. Use the literal src attribute, not the browser-resolved src.
export function getPhotoImageFallback(originalUrl: string, failedUrl: string): string | null {
  const thumbnailUrl = getPhotoThumbnailUrl(originalUrl);
  return thumbnailUrl !== originalUrl && failedUrl === thumbnailUrl ? originalUrl : null;
}

export function getPhotoThumbnailDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid photo dimensions");
  }
  const scale = Math.min(1, PHOTO_THUMBNAIL_MAX_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}