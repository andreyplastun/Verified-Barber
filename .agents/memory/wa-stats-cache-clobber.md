---
name: WA admin stats counter zeroed after saving settings
description: Why the "Сегодня отдано" counter shows 0 despite messages being sent, and the react-query cache-clobber rule behind it
---

# WA stats counter reads 0 while sends actually happened

Symptom: admin dashboard "Сегодня отдано: 0 осн." even though messages were sent and the DB has the rows. The backend is NOT at fault — calling `GET /api/admin/whatsapp/stats` returns `sentTodayByType` correctly.

**Root cause (frontend cache clobber):** the WA settings **save** mutation and the WA **stats** GET share the same react-query key `['/api/admin/whatsapp/stats']`. The save mutation's `onSuccess` overwrote that whole cache entry with the `POST /api/admin/whatsapp/settings` response, which returns **settings only** (enabled/warmupStartDate/dailyLimit/followupEnabled) with **no counters**. So the moment the admin toggled any WA setting, `sentTodayByType` became undefined and the UI fell back to `{primary:0,reminder:0}` — and stayed 0 until a full stats refetch.

**Fix / rule:** when a narrow save-response and a wider GET feed the *same* query key, never blindly `setQueryData(key, saveResponse)`. Merge the save response into the existing cache (`prev => ({ ...prev, ...data })`) to keep the wider fields, then `invalidateQueries` to refetch authoritative values.
**Why:** the save endpoint is intentionally thin; the counters only come from the GET. A full overwrite drops every field the save doesn't return.
**How to apply:** audit any mutation whose `onSuccess`/`onMutate` calls `setQueryData` on a key that a broader query also owns. Same trap applies to any settings-vs-stats split sharing one key.

**Debugging shortcut:** to prove backend-vs-frontend for admin-gated endpoints, fetch an `role=admin` user id from prod (Supabase REST) and call the live endpoint with header `x-user-id: <id>` — `checkAdminRole` only checks that. If the JSON is correct but the screen is wrong, it's a client cache/render bug.
