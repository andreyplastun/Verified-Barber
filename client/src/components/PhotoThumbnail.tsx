import type { ImgHTMLAttributes } from "react";
import { SpecialistPhoto } from "@/components/specialist-photo";

type PhotoThumbnailProps = ImgHTMLAttributes<HTMLImageElement> & { src: string };

// Preserve the original browser loading default for existing callers while
// sharing preview selection and URL-keyed fallback with SpecialistPhoto.
export default function PhotoThumbnail({ loading = "eager", ...props }: PhotoThumbnailProps) {
  return <SpecialistPhoto {...props} loading={loading} />;
}
