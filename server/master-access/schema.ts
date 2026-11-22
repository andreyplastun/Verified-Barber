import type { Pool } from "pg";
import { normalizeClaimPhone } from "../../shared/claim-phone";
// Reviewed production request/profile pairs. No phone numbers, names, or tokens in source.
// Never select arbitrary approved requests, contact fields on profiles, or Altegio data.
export const historical = [
  [21, 51],
  [10, 73],
  [9, 72],
  [32, 93],
  [24, 90],
  [29, 8],
  [20, 9],
  [15, 18],
  [16, 22],
  [31, 25],
  [17, 26],
];
export async function prepareMasterAccess(db: Pool, prepareLegacy: boolean) {
  await db.query(`CREATE SCHEMA IF NOT EXISTS rateus_private;
 REVOKE ALL ON SCHEMA rateus_private FROM PUBLIC;
 CREATE TABLE IF NOT EXISTS rateus_private.master_codes(id uuid PRIMARY KEY, purpose text NOT NULL, phone text NOT NULL, specialist_id int NOT NULL, anon_id text NOT NULL, ip_hash text NOT NULL, digest text NOT NULL, attempts int NOT NULL DEFAULT 0, state text NOT NULL DEFAULT 'sending', created_at timestamptz NOT NULL DEFAULT now());
 ALTER TABLE rateus_private.master_codes ADD COLUMN IF NOT EXISTS charged boolean NOT NULL DEFAULT false;
 CREATE INDEX IF NOT EXISTS master_codes_time ON rateus_private.master_codes(created_at);
 CREATE TABLE IF NOT EXISTS rateus_private.master_claims(claim_id int PRIMARY KEY REFERENCES claim_requests(id), specialist_id int NOT NULL, phone text NOT NULL, anon_id text, verified_at timestamptz, legacy boolean NOT NULL DEFAULT false, needs_review boolean NOT NULL DEFAULT false, reviewed_by text, bound_user text, notified boolean NOT NULL DEFAULT false);
 ALTER TABLE rateus_private.master_claims ADD COLUMN IF NOT EXISTS first_login_at timestamptz;
 CREATE TABLE IF NOT EXISTS rateus_private.claim_invites(reminder_id int PRIMARY KEY,claim_id int NOT NULL REFERENCES rateus_private.master_claims(claim_id),requested_by text NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),handoff_at timestamptz,finished_at timestamptz,response text);
 CREATE INDEX IF NOT EXISTS claim_invites_latest ON rateus_private.claim_invites(claim_id,reminder_id DESC);
 CREATE INDEX IF NOT EXISTS master_claim_phone ON rateus_private.master_claims(phone);
 CREATE TABLE IF NOT EXISTS rateus_private.master_identity(phone text PRIMARY KEY, user_id text UNIQUE NOT NULL,specialist_id int UNIQUE NOT NULL);
 ALTER TABLE rateus_private.master_identity ADD COLUMN IF NOT EXISTS bound_at timestamptz;
 ALTER TABLE rateus_private.master_claims ADD COLUMN IF NOT EXISTS disputed_owner text, ADD COLUMN IF NOT EXISTS dispute_decision text, ADD COLUMN IF NOT EXISTS decision_by text, ADD COLUMN IF NOT EXISTS decision_at timestamptz;
 CREATE UNIQUE INDEX IF NOT EXISTS master_open_dispute_phone ON rateus_private.master_claims(specialist_id,phone) WHERE disputed_owner IS NOT NULL AND dispute_decision IS NULL;
 CREATE TABLE IF NOT EXISTS rateus_private.revoked_owners(specialist_id int NOT NULL,user_id text NOT NULL,PRIMARY KEY(specialist_id,user_id));
 `);
  if (!prepareLegacy) return;
  for (const [cid, sid] of historical) {
    const {
      rows: [r],
    } = await db.query(
      `SELECT c.phone,s.owner_user_id,EXISTS(SELECT 1 FROM users u WHERE u.specialist_id=s.id) AS conflict FROM claim_requests c JOIN specialists s ON s.id=c.specialist_id WHERE c.id=$1 AND s.id=$2 AND c.status='approved' AND c.token_used_at IS NULL`,
      [cid, sid],
    );
    const phone = normalizeClaimPhone(r?.phone);
    if (!phone || r.owner_user_id) continue;
    await db.query(
      `INSERT INTO rateus_private.master_claims(claim_id,specialist_id,phone,legacy,needs_review) VALUES($1,$2,$3,true,$4) ON CONFLICT DO NOTHING`,
      [cid, sid, phone, r.conflict || [8, 9, 18, 22, 25, 26].includes(sid)],
    );
  }
}
