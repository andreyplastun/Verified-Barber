import { useState, type ImgHTMLAttributes } from "react";
import { getPhotoImageFallback, getPhotoThumbnailUrl } from "@shared/photo-images";

type PhotoThumbnailProps = ImgHTMLAttributes<HTMLImageElement> & { src: string };

// Keep URL fallback state tied to the original so changing a photo tries its
// new thumbnail. Never rewrite an original URL after its own onError.
export default function PhotoThumbnail({ src, onError, decoding = "async", ...props }: PhotoThumbnailProps) {
  const [failedOriginal, setFailedOriginal] = useState<string | null>(null);
  return (
    <img
      {...props}
      decoding={decoding}
      src={failedOriginal === src ? src : getPhotoThumbnailUrl(src)}
      onError={event => {
        if (getPhotoImageFallback(src, event.currentTarget.getAttribute("src") || "")) {
          setFailedOriginal(src);
        }
        onError?.(event);
      }}
    />
  );
}