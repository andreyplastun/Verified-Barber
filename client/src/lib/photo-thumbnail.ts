import {
  getPhotoThumbnailDimensions,
  PHOTO_THUMBNAIL_MAX_BYTES,
} from "@shared/photo-images";

// The original File is never re-encoded or replaced. Only this additional Blob
// is sent alongside it. Modern image decoders apply EXIF before we read sizes.
export async function createPhotoThumbnail(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png"].includes(file.type)) {
    throw new Error("Only JPG and PNG thumbnails are supported");
  }

  let source: ImageBitmap | HTMLImageElement;
  let release: () => void;
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
    release = () => (source as ImageBitmap).close();
  } else {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not decode photo"));
        image.src = url;
      });
      source = image;
      release = () => URL.revokeObjectURL(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  try {
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const dimensions = getPhotoThumbnailDimensions(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Thumbnail canvas unavailable");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const encode = () => new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not encode thumbnail")), file.type, 0.78);
    });
    let thumbnail = await encode();
    if (thumbnail.size > PHOTO_THUMBNAIL_MAX_BYTES && Math.max(canvas.width, canvas.height) > 256) {
      // Detailed PNGs may exceed the byte bound at 320px. Keep their format and
      // alpha while trying the smaller allowed edge, again from the original.
      const scale = 256 / Math.max(canvas.width, canvas.height);
      canvas.width = Math.max(1, Math.round(canvas.width * scale));
      canvas.height = Math.max(1, Math.round(canvas.height * scale));
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      thumbnail = await encode();
    }
    if (thumbnail.type !== file.type || thumbnail.size === 0 || thumbnail.size > PHOTO_THUMBNAIL_MAX_BYTES) {
      throw new Error("Thumbnail format or size unsupported");
    }
    return thumbnail;
  } finally {
    release();
  }
}

export async function createPhotoUploadForm(file: File, photoType: "avatar" | "work"): Promise<{ formData: FormData; warning?: string }> {
  const formData = new FormData();
  formData.append("photo", file);
  formData.append("photoType", photoType);
  try {
    const thumbnail = await createPhotoThumbnail(file);
    formData.append("thumbnail", thumbnail, file.type === "image/png" ? "thumbnail.png" : "thumbnail.jpg");
    return { formData };
  } catch (error) {
    return {
      formData,
      warning: `Фото сохранено без уменьшенной копии: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}