---
name: Altegio avatar import & refresh
description: Why Altegio-imported specialist photos go stale / show as "no photo" and how the sync must handle avatars.
---

# Altegio specialist avatars

Altegio's `book_staff` API returns a **default placeholder URL** when a master has no real photo — e.g. `https://be.cdn.alteg.io/images/no-master-sm.png` (also `no-photo`/`no_master` variants). It is NOT empty/null. Real photos are `https://assets.alteg.io/masters/...` (content-hashed filename; changes only when the photo changes).

Two distinct failure modes (both seen 2026-06-24):
1. **Placeholder stored as a photo.** Storing the placeholder makes the profile count as "has photo", so activation never flags photo-missing and reminders never nudge for a photo. The frontend activation check only excludes URLs containing the literal word `placeholder`, so `no-master-sm.png` slips through.
2. **Avatar never refreshed.** The avatar was captured only at specialist creation. `autoMapAltegioStaff` skips already-mapped specialists, so a photo added in Altegio *after* import never propagated.

**Fixes (in `server/altegio.ts`):**
- `normalizeAltegioAvatar()` drops placeholder URLs → null at the staff-list fetch, so placeholders are never stored.
- In the `alreadyMapped` branch, refresh the avatar via `storage.updateSpecialistAvatar` guarded by `shouldRefreshAltegioAvatar(current, new)`: overwrite only when current is empty or an `alteg.io`-hosted URL; **never overwrite a manually uploaded photo** (Supabase Storage URL). Identical content-hash URLs short-circuit → no write storm.

**Why:** legit masters add photos in Altegio at any time; without refresh the WHO profile shows the grey fallback even though Altegio has the real photo.

**How to apply:** the startup automap sync (runs on Railway boot) refreshes existing rows automatically after deploy — no manual prod backfill needed. When touching avatar import, keep both the placeholder filter and the manual-upload protection.
