import type { Pool } from "pg";
import { normalizeClaimPhone } from "../../shared/claim-phone";
// Reviewed production request/profile pairs. No phone numbers, names, or tokens in source.
// Never select arbitrary approved requests, contact fields on profiles, or Altegio data.
const historical = [
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
 CREATE INDEX IF NOT EXISTS master_claim_phone ON rateus_private.master_claims(phone);
 CREATE TABLE IF NOT EXISTS rateus_private.master_identity(phone text PRIMARY KEY, user_id text UNIQUE NOT NULL,specialist_id int UNIQUE NOT NULL);
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
