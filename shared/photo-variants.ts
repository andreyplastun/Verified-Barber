import { getPhotoDeletePaths, getPhotoThumbnailUrl } from "./photo-images";

// Only this versioned namespace guarantees a successfully uploaded preview.
// Legacy, external and signed URLs must keep using their original image.
const originalPath = /^photos\/preview-v1\/[0-9a-f-]{36}\/original\.(jpg|png)$/;

export function getPhotoPreviewPath(path: string): string | null {
  return originalPath.test(path) ? path.replace("/original.", "/preview.") : null;
}

export function getPhotoPreviewUrl(original: string): string {
  try {
    const url = new URL(original);
    if (!["https:", "http:"].includes(url.protocol)) return original;
    const prefix = "/storage/v1/object/public/specialist-photos/";
    if (!url.pathname.startsWith(prefix)) return original;
    const preview = getPhotoPreviewPath(url.pathname.slice(prefix.length));
    if (!preview) return getPhotoThumbnailUrl(original);
    url.pathname = prefix + preview;
    return url.href;
  } catch {
    return original;
  }
}

// Used only for an explicit user deletion, never for background cleanup.
export function getPhotoStoragePaths(path: string): string[] {
  const preview = getPhotoPreviewPath(path);
  return preview ? [path, preview] : getPhotoDeletePaths(path);
}