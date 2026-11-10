// Authorized one-off recovery window. Dry run by default; never log phones/tokens.
import { randomBytes } from "node:crypto";
import { normalizeClaimPhone } from "../shared/claim-phone";

const apply = process.argv.includes("--apply");
const base = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Supabase credentials are not configured");
async function api(path: string, method = "GET", body?: unknown): Promise<any[]> {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key!,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supabase ${method} failed: HTTP ${response.status}`);
  return response.json();
}

const claims = await api("claim_requests?select=id,specialist_id,phone,claim_token,token_expires_at&status=eq.approved&token_used_at=is.null&created_at=gte.2026-08-10T00:00:00Z&created_at=lt.2026-11-11T00:00:00Z&order=created_at.desc&limit=1000");
if (claims.length >= 1000) throw new Error("Pagination required; refusing partial recovery");
const counts = { eligible: 0, queued: 0, alreadySent: 0, owned: 0, invalidPhone: 0, duplicate: 0, inFlight: 0 };
const seen = new Set<number>();
for (const claim of claims) {
  if (seen.has(claim.specialist_id)) { counts.duplicate++; continue; }
  seen.add(claim.specialist_id);
  const [specialist] = await api(`specialists?select=id,name,owner_user_id&id=eq.${claim.specialist_id}`);
  if (!specialist || specialist.owner_user_id) { counts.owned++; continue; }
  // A previous approval handoff for this profile must not be resent.
  const sent = await api(`specialist_reminders?select=id&specialist_id=eq.${claim.specialist_id}&reminder_type=eq.claim_approved&status=eq.sent&limit=1`);
  if (sent.length) { counts.alreadySent++; continue; }
  const [existing] = await api(`specialist_reminders?select=id,status&claim_request_id=eq.${claim.id}&limit=1`);
  if (existing) { counts.inFlight++; continue; } // Never reset sending/uncertain outcomes.
  const phone = normalizeClaimPhone(claim.phone);
  if (!phone) { counts.invalidPhone++; continue; }
  counts.eligible++;
  if (!apply) continue;
  // Rotate expired tokens rather than reviving an old expired URL.
  let token = claim.claim_token;
  if (!token || new Date(claim.token_expires_at || 0).getTime() <= Date.now()) {
    token = randomBytes(16).toString("base64url");
    const updated = await api(
      `claim_requests?id=eq.${claim.id}&status=eq.approved&token_used_at=is.null`,
      "PATCH", { claim_token: token, token_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
    );
    if (updated.length !== 1) throw new Error("Claim changed during recovery");
  }
  await api("specialist_reminders", "POST", {
    specialist_id: claim.specialist_id,
    claim_request_id: claim.id,
    phone: phone.replace(/\D/g, ""),
    reminder_type: "claim_approved",
    status: "queued",
    message_text: `Здравствуйте! Ваш запрос на профиль «${specialist.name}» на Rateus одобрен. Перейдите по ссылке для привязки: https://rateus.kz/claim/${token}`,
    dedupe_key: `claim-approved:${claim.id}`,
    scheduled_at: new Date().toISOString(),
  });
  counts.queued++;
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...counts }));
