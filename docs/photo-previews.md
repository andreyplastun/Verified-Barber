# Specialist photo previews

## Scope and compatibility

- New specialist uploads keep the original bytes and original public URL in the database.
- A companion JPEG/PNG preview is fitted inside 480 × 480 (no crop/upscale). JPEG quality is 78; PNG alpha is preserved. Preview EXIF is removed after applying orientation.
- The versioned `photos/preview-v1/<uuid>/original.{jpg,png}` namespace guarantees a corresponding `preview` object. Legacy/external/signed URLs are not rewritten.
- Existing `thumb-v1` pairs from the main branch remain supported for display, fallback and explicit deletion. `PhotoThumbnail` delegates to the shared photo component so other profile/review pages can display both conventions.
- The upload endpoint still accepts the optional `thumbnail` field from older clients and validates it, but derives the new preview from the original on the server. The dashboard no longer performs redundant browser compression.
- Catalog, profile gallery, dashboard and onboarding avatars use native lazy loading, async decoding and a one-way fallback to original on preview failure. The large profile hero uses the original eagerly. Gallery links open originals only on demand.
- New immutable object keys use one-year cache control and never overwrite files. JPEG/PNG work with the existing bucket policy; no Supabase Image Transformations or bucket migrations.
- Avatar replacement saves the new image before removing old database records, retaining the old storage objects so their URLs still work. Explicit user deletion of a photo removes its original and companion. No background deletion or production backfill.
- A failed upload does not publish a versioned URL; partial objects can remain in storage. No cleanup of production objects is authorized by this change.
- Decoder input limits: 5 MiB, 40 million pixels, JPEG/PNG signature matching, two concurrent decodes, ten-second processing timeout. Invalid input returns 400; a full processing queue returns 429 with Retry-After.

## Verification

Safe commands (no database or app worker startup):

```sh
npx tsx --test server/photo-processing.test.ts server/photo-images.test.ts server/photo-storage.test.ts
npx tsc --noEmit
npx tsx script/build.ts --compile-only
```

Measured encoded deterministic test files, 1600 × 1000 → 480 × 300:

| Format | Original bytes | Preview bytes | Reduction |
| --- | ---: | ---: | ---: |
| JPEG | 1,627,245 | 37,676 | 97.7% |
| PNG | 4,809,586 | 353,429 | 92.7% |

These are fixture measurements, not measured savings for production Supabase traffic.
Original-byte SHA-256, EXIF orientation, PNG alpha, malformed/truncated/oversized input, pixel limits, concurrency, storage failures, both URL conventions, caching and explicit deletion paths are covered by 24 passing tests after integration with the main branch.

TypeScript and compile-only build passed. Build retained existing Tailwind ambiguity and large-bundle warnings.

Visual checks used compiled frontend with a temporary isolated fixture server, not the real backend. Catalog and profile gallery displayed the new preview, a legacy URL, and a deliberately missing preview (404) that fell back to the original. Evidence: `screenshots/photo-preview-catalog.jpg`, `screenshots/photo-preview-profile.jpg`. Request logs confirmed the catalog used the preview rather than the full-size original. Temporary server was stopped and removed.

No real uploads, production data writes, normal build or application restart were performed. Existing production files remain unprocessed; their only immediate improvement is lazy loading. Measuring actual traffic and processing legacy files require separate follow-up and explicit approval for any production backfill.