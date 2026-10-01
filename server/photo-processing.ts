import sharp from "sharp";

export class InvalidPhotoError extends Error {}
export class PhotoProcessingBusyError extends Error {}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
let processing = 0;

/** Decode bounded inputs, orient the preview, and keep original bytes untouched. */
export async function createPhotoPreview(file: Buffer, contentType: string) {
  if (!file.length || file.length > MAX_BYTES) {
    throw new InvalidPhotoError("Размер фотографии должен быть не больше 5 МБ");
  }
  if (!["image/jpeg", "image/png"].includes(contentType)) {
    throw new InvalidPhotoError("Поддерживаются только JPG и PNG");
  }
  // Avoid an unbounded queue of decoded multi-megapixel uploads.
  if (processing >= 2) {
    throw new PhotoProcessingBusyError("Обработка фотографий занята. Попробуйте ещё раз");
  }
  processing++;
  try {
    const image = sharp(file, { limitInputPixels: MAX_PIXELS, failOn: "warning" })
      .timeout({ seconds: 10 });
    const metadata = await image.metadata();
    const format = contentType === "image/jpeg" ? "jpeg" : "png";
    if (metadata.format !== format) {
      throw new InvalidPhotoError("Содержимое файла не соответствует формату фотографии");
    }
    const resized = image.rotate().resize({
      width: 480,
      height: 480,
      fit: "inside",
      withoutEnlargement: true,
    });
    // PNG preserves transparency and works with the existing bucket MIME policy.
    const preview = await (format === "jpeg"
      ? resized.jpeg({ quality: 78, progressive: true })
      : resized.png({ compressionLevel: 9 })).toBuffer();
    return {
      preview,
      extension: format === "jpeg" ? "jpg" : "png",
      contentType,
    };
  } catch (error) {
    if (error instanceof InvalidPhotoError) throw error;
    throw new InvalidPhotoError(
      "Не удалось прочитать фотографию. Используйте корректный JPG или PNG до 40 мегапикселей",
    );
  } finally {
    processing--;
  }
}