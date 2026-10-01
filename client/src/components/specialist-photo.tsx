import { useState, type ImgHTMLAttributes } from "react";
import { getPhotoPreviewUrl } from "@shared/photo-variants";

type SpecialistPhotoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
};

function PhotoPreview({
  src,
  loading = "lazy",
  decoding = "async",
  onError,
  ...props
}: SpecialistPhotoProps) {
  const [useOriginal, setUseOriginal] = useState(false);
  const previewUrl = getPhotoPreviewUrl(src);

  return (
    <img
      {...props}
      src={useOriginal ? src : previewUrl}
      loading={loading}
      decoding={decoding}
      onError={(event) => {
        if (!useOriginal && previewUrl !== src) {
          setUseOriginal(true);
        }
        onError?.(event);
      }}
    />
  );
}

export function SpecialistPhoto(props: SpecialistPhotoProps) {
  // Remount the preview state when the original URL changes, without briefly
  // requesting the new original after a previous photo's preview failed.
  return <PhotoPreview key={props.src} {...props} />;
}