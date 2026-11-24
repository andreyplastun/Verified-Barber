import { wakeQueue } from "../queue-wake";
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { normalizeClaimPhone } from "../../shared/claim-phone";
import type { Providers } from "./providers";
export class AccessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, text: string): never => {
  throw new AccessError(status, text);
};
const owned = "У профиля уже есть владелец, свяжитесь с поддержкой";
const wrong = "Неверный или просроченный код. Запросите новый.";
export type Purpose = "claim" | "login";
export class MasterAccess {
  constructor(
    private db: Pool,
    private adapter: Providers,
    private secret: string,
    private requestCreated?: (id: number) => Promise<void>,
  ) {}
  private hash(s: string) {
    if (!this.secret) throw Error("Missing OTP secret");
    return createHmac("sha256", this.secret)
      .update("master-access/v1:" + s)
      .digest("hex");
  }
  private async tx<T>(fn: (t: PoolClient) => Promise<T>) {
    const t = await this.db.connect();
    try {
      await t.query("BEGIN");
      const r = await fn(t);
      await t.query("COMMIT");
      wakeQueue();
      return r;
    } catch (e) {
      await t.query("ROLLBACK");
      throw e;
    } finally {
      t.release();
    }
  }
  private async event(
    t: Pick<Pool, "query">,
    e: string,
    sid: number,
    anon: string,
    meta = {},
  ) {
    await t.query(
      `INSERT INTO analytics_events(event_type,specialist_id,anon_id,source,metadata) VALUES($1,$2,$3,'master_access',$4)`,
      [e, sid, anon, JSON.stringify(meta)],
    );
  }
  private async target(
    t: PoolClient,
    phone: string,
  ): Promise<{
    sid: number;
    claim: Record<string, any> | null;
    userId?: string;
  } | null> {
    const bound = await t.query(
      `SELECT i.specialist_id FROM rateus_private.master_identity i JOIN specialists s ON s.id=i.specialist_id AND s.owner_user_id::text=i.user_id JOIN users u ON u.id::text=i.user_id AND u.specialist_id=s.id AND u.role='specialist' WHERE i.phone=$1`,
      [phone],
    );
    if (bound.rows.length)
      return { sid: bound.rows[0].specialist_id, claim: null };
    const existing = await this.adapter.existingOwner?.(t, phone);
    if (existing) return { ...existing, claim: null };
    const { rows } = await t.query(
      `SELECT m.* FROM rateus_private.master_claims m JOIN claim_requests c ON c.id=m.claim_id AND c.specialist_id=m.specialist_id JOIN specialists s ON s.id=c.specialist_id WHERE m.phone=$1 AND m.legacy AND m.bound_user IS NULL AND c.status='approved' AND c.token_used_at IS NULL AND s.owner_user_id IS NULL`,
      [phone],
    );
    return rows.length === 1
      ? { sid: rows[0].specialist_id, claim: rows[0] }
      : null;
  }
  private async free(t: PoolClient, sid: number, allowOwned = false) {
    const {
      rows: [s],
    } = await t.query(
      "SELECT id,name,owner_user_id FROM specialists WHERE id=$1 FOR UPDATE",
      [sid],
    );
    if (!s) fail(404, "Профиль не найден");
    if (s.owner_user_id && !allowOwned) fail(409, owned);
    return s;
  }
  private async checkNew(t: PoolClient, sid: number) {
    const s = await this.free(t, sid, true);
    if (s.owner_user_id) return String(s.owner_user_id);
    const { rows } = await t.query(
      `SELECT 1 FROM claim_requests WHERE specialist_id=$1 AND (status='pending' OR (status='approved' AND (token_used_at IS NOT NULL OR token_expires_at>now()))) LIMIT 1`,
      [sid],
    );
    if (rows.length)
      fail(409, "По профилю уже есть заявка. Обратитесь в поддержку.");
  }
  async request(
    purpose: Purpose,
    input: string,
    sid: number,
    anon: string,
    ip: string,
  ) {
    const phone = normalizeClaimPhone(input);
    if (!phone)
      throw new AccessError(400, "Введите казахстанский мобильный номер");
    const id = randomUUID(),
      code = String(randomInt(100000, 1000000)),
      ipKey = this.hash("ip:" + ip);
    const burst = await this.tx(async (t) => {
      await t.query("SELECT pg_advisory_xact_lock(602173144)"); // serialize reservations, not provider I/O
      const {
        rows: [n],
      } = await t.query(
        `SELECT count(*) FILTER(WHERE phone=$1)::int AS phone,count(*) FILTER(WHERE ip_hash=$2)::int AS ip,count(*)::int AS total, bool_or(phone=$1 AND created_at>now()-interval '60 seconds') AS recent FROM rateus_private.master_codes WHERE created_at>now()-interval '1 hour'`,
        [phone, ipKey],
      );
      if (n.recent || n.phone >= 5 || n.ip >= 30 || n.total >= 150)
        fail(
          429,
          "Слишком много запросов. Подождите перед повторной отправкой.",
        );
      let known = true;
      if (purpose === "claim") {
        await this.checkNew(t, sid);
        await this.event(t, "claim_phone_submitted", sid, anon);
      } else {
        const target = await this.target(t, phone);
        known = !!target;
        sid = target?.sid ?? 0;
      }
      await t.query(
        `DELETE FROM rateus_private.master_codes WHERE created_at<now()-interval '2 days'`,
      );
      await t.query(
        `UPDATE rateus_private.master_codes SET state='replaced' WHERE phone=$1 AND purpose=$2 AND state IN ('sent','sending')`,
        [phone, purpose],
      );
      await t.query(
        `INSERT INTO rateus_private.master_codes(id,purpose,phone,specialist_id,anon_id,ip_hash,digest,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          purpose,
          phone,
          sid,
          anon,
          ipKey,
          this.hash(id + ":" + code),
          known ? "sending" : "unknown",
        ],
      );
      return known;
    });
    if (burst) {
      let receipt;
      try {
        receipt = await this.adapter.sendCode(phone, code, id);
      } catch {
        await this.db.query(
          `UPDATE rateus_private.master_codes SET state='failed' WHERE id=$1`,
          [id],
        );
        await this.event(
          this.db,
          purpose === "claim" ? "claim_code_sent" : "master_login_code_sent",
          sid,
          anon,
          { result: "failed" },
        );
        throw new AccessError(
          503,
          "WhatsApp не подтвердил отправку. Попробуйте ещё раз через минуту.",
        );
      }
      await this.db.query(
        `UPDATE rateus_private.master_codes SET state='sent' WHERE id=$1 AND state='sending'`,
        [id],
      );
      await this.event(
        this.db,
        purpose === "claim" ? "claim_code_sent" : "master_login_code_sent",
        sid,
        anon,
        {
          result: "accepted",
          providerId: receipt.id,
          httpStatus: receipt.status,
        },
      );
    }
    return { challengeId: id, retryAfter: 60 };
  }
  async verify(purpose: Purpose, id: string, code: string) {
    const result = await this.tx(async (t) => {
      const {
        rows: [o],
      } = await t.query(
        `SELECT * FROM rateus_private.master_codes WHERE id=$1 AND purpose=$2 AND state='sent' AND attempts<5 AND created_at>now()-interval '10 minutes' FOR UPDATE`,
        [id, purpose],
      );
      if (!o) return null;
      if (
        !timingSafeEqual(
          Buffer.from(o.digest, "hex"),
          Buffer.from(this.hash(id + ":" + code), "hex"),
        )
      ) {
        await t.query(
          "UPDATE rateus_private.master_codes SET attempts=attempts+1 WHERE id=$1",
          [id],
        );
        return null;
      }
      await t.query(
        `UPDATE rateus_private.master_codes SET state='used' WHERE id=$1`,
        [id],
      );
      if (purpose === "claim") {
        const currentOwner = await this.checkNew(t, o.specialist_id);
        if (currentOwner) {
          const {
            rows: [exists],
          } = await t.query(
            `SELECT claim_id FROM rateus_private.master_claims WHERE specialist_id=$1 AND phone=$2 AND disputed_owner IS NOT NULL AND dispute_decision IS NULL`,
            [o.specialist_id, o.phone],
          );
          if (exists) return { message: "Спор уже передан администратору." };
          const {
            rows: [self],
          } = await t.query(
            "SELECT 1 FROM rateus_private.master_identity WHERE specialist_id=$1 AND phone=$2 AND user_id=$3",
            [o.specialist_id, o.phone, currentOwner],
          );
          if (self)
            return {
              message:
                "Этот профиль уже привязан к вашему номеру. Войдите по WhatsApp.",
            };
          const {
            rows: [c],
          } = await t.query(
            `INSERT INTO claim_requests(specialist_id,phone,status) VALUES($1,$2,'pending') RETURNING id`,
            [o.specialist_id, o.phone],
          );
          await t.query(
            `INSERT INTO rateus_private.master_claims(claim_id,specialist_id,phone,anon_id,verified_at,disputed_owner) VALUES($1,$2,$3,$4,now(),$5)`,
            [c.id, o.specialist_id, o.phone, o.anon_id, currentOwner],
          );
          await this.event(
            t,
            "claim_code_verified",
            o.specialist_id,
            o.anon_id,
          );
          await this.event(
            t,
            "claim_request_created",
            o.specialist_id,
            o.anon_id,
            { dispute: true },
          );
          return {
            requestId: Number(c.id),
            message:
              "Заявка принята как спор о профиле. Администратор проверит её. Владелец пока не изменён.",
          };
        }
        if (
          (
            await t.query(
              `SELECT 1 FROM rateus_private.master_claims WHERE legacy AND phone=$1 AND specialist_id=$2`,
              [o.phone, o.specialist_id],
            )
          ).rowCount
        )
          return {
            message:
              "Ваша заявка уже одобрена. Используйте вход мастера по телефону.",
          };
        const {
          rows: [c],
        } = await t.query(
          `INSERT INTO claim_requests(specialist_id,phone,status) VALUES($1,$2,'pending') RETURNING id`,
          [o.specialist_id, o.phone],
        );
        await t.query(
          `INSERT INTO rateus_private.master_claims(claim_id,specialist_id,phone,anon_id,verified_at,needs_review) VALUES($1,$2,$3,$4,now(),EXISTS(SELECT 1 FROM users WHERE specialist_id=$2))`,
          [c.id, o.specialist_id, o.phone, o.anon_id],
        );
        await this.event(t, "claim_code_verified", o.specialist_id, o.anon_id);
        await this.event(
          t,
          "claim_request_created",
          o.specialist_id,
          o.anon_id,
        );
        return {
          requestId: Number(c.id),
          message: "Номер подтверждён. Заявка отправлена администратору.",
        };
      }
      const target = await this.target(t, o.phone);
      if (!target || target.sid !== o.specialist_id)
        fail(409, "Вход недоступен. Обратитесь в поддержку.");
      if (target!.claim) {
        const m = target!.claim;
        await t.query(
          "UPDATE rateus_private.master_claims SET verified_at=now(),anon_id=$2 WHERE claim_id=$1",
          [m.claim_id, o.anon_id],
        );
        await this.event(t, "claim_code_verified", o.specialist_id, o.anon_id);
        if (
          (m.needs_review || (await this.hasPrior(t, o.specialist_id))) &&
          !m.reviewed_by
        )
          return {
            message:
              "Номер подтверждён. Требуется ручная сверка администратором. Войдите после подтверждения.",
          };
        await this.bind(t, m.claim_id, o.anon_id, false);
      }
      const {
        rows: [i],
      } = await t.query(
        "SELECT user_id FROM rateus_private.master_identity WHERE phone=$1 AND specialist_id=$2",
        [o.phone, o.specialist_id],
      );
      const uid = i?.user_id ?? target?.userId;
      if (!uid) fail(409, "Профиль не привязан");
      return {
        userId: uid as string,
        phone: o.phone as string,
        sid: o.specialist_id as number,
        anon: o.anon_id as string,
      };
    });
    if (!result) throw new AccessError(400, wrong);
    if (!result.userId) {
      if (result.requestId && this.requestCreated)
        void this.requestCreated(result.requestId).catch(() => {});
      return { message: result.message };
    }
    const session = await this.adapter.session(result.userId, result.phone!);
    await this.event(
      this.db,
      "master_login_success",
      result.sid!,
      result.anon!,
    );
    await this.db.query(
      `UPDATE rateus_private.master_claims m SET first_login_at=now() FROM specialists s WHERE m.specialist_id=$1 AND s.id=m.specialist_id AND s.owner_user_id::text=$2 AND m.bound_user=$2 AND m.phone=$3 AND m.first_login_at IS NULL AND m.legacy`,
      [result.sid, result.userId, result.phone],
    );
    return { session };
  }
  private async hasPrior(t: PoolClient, sid: number) {
    return !!(
      await t.query("SELECT 1 FROM users WHERE specialist_id=$1 LIMIT 1", [sid])
    ).rowCount;
  }
  private async bind(
    t: PoolClient,
    cid: number,
    anon: string,
    notify: boolean,
  ) {
    const {
      rows: [m],
    } = await t.query(
      `SELECT m.*,c.status FROM rateus_private.master_claims m JOIN claim_requests c ON c.id=m.claim_id AND c.specialist_id=m.specialist_id WHERE m.claim_id=$1 FOR UPDATE OF m,c`,
      [cid],
    );
    if (
      !m?.verified_at ||
      m.status !== (m.legacy ? "approved" : "pending") ||
      m.bound_user
    )
      fail(409, "Заявка не готова к привязке");
    const s = await this.free(t, m.specialist_id);
    if ((m.needs_review || (await this.hasPrior(t, s.id))) && !m.reviewed_by)
      fail(409, "Требуется ручная сверка администратором");
    await t.query("SELECT pg_advisory_xact_lock(94217,hashtext($1))", [
      m.phone,
    ]);
    if (
      (
        await t.query(
          "SELECT 1 FROM rateus_private.master_identity WHERE phone=$1 OR specialist_id=$2",
          [m.phone, s.id],
        )
      ).rowCount
    )
      fail(409, "Номер или профиль уже привязан");
    const a = await this.adapter.account(t, m.phone);
    if (/@who\.kz$/i.test(a.email))
      fail(409, "Старый аккаунт не изменён. Обратитесь в поддержку.");
    const r = await t.query(
      `INSERT INTO users(id,email,role,specialist_id,onboarding_completed) VALUES($1,$2,'specialist',$3,true) ON CONFLICT(id) DO UPDATE SET role='specialist',specialist_id=$3,onboarding_completed=true WHERE users.role<>'admin' AND users.email NOT ILIKE '%@who.kz' AND (users.specialist_id IS NULL OR users.specialist_id=$3) RETURNING id`,
      [a.id, a.email, s.id],
    );
    if (!r.rowCount) fail(409, "Нельзя привязать этот аккаунт");
    await t.query(
      "UPDATE specialists SET owner_user_id=$1 WHERE id=$2 AND owner_user_id IS NULL",
      [a.id, s.id],
    );
    await t.query(
      "INSERT INTO rateus_private.master_identity(phone,user_id,specialist_id,bound_at) VALUES($1,$2,$3,clock_timestamp())",
      [m.phone, a.id, s.id],
    );
    await t.query(
      `UPDATE claim_requests SET status='approved',resolved_at=coalesce(resolved_at,now()),claim_token=NULL,token_expires_at=NULL WHERE id=$1`,
      [cid],
    );
    await t.query(
      "UPDATE rateus_private.master_claims SET bound_user=$2 WHERE claim_id=$1",
      [cid, a.id],
    );
    await t.query(
      "DELETE FROM rateus_private.revoked_owners WHERE specialist_id=$1 AND user_id=$2",
      [s.id, a.id],
    );
    await this.event(t, "claim_approved", s.id, anon, { legacy: m.legacy });
    if (notify)
      await t.query(
        `INSERT INTO specialist_reminders(specialist_id,claim_request_id,phone,reminder_type,status,message_text,dedupe_key,scheduled_at) VALUES($1,$2,$3,'claim_approved','queued',$4,$5,now())`,
        [
          s.id,
          cid,
          m.phone.slice(1),
          `Ваш профиль „${s.name}“ на Rateus одобрен. Войдите по номеру телефона: https://www.rateus.kz/login`,
          "verified-approval:" + cid,
        ],
      );
  }
  async resolveDispute(
    cid: number,
    admin: string,
    decision: "keep" | "transfer",
    expectedOwner: string,
  ) {
    return this.tx(async (t) => {
      const {
        rows: [m],
      } = await t.query(
        `SELECT m.*,c.status FROM rateus_private.master_claims m JOIN claim_requests c ON c.id=m.claim_id WHERE m.claim_id=$1 FOR UPDATE OF m,c`,
        [cid],
      );
      if (
        !m?.disputed_owner ||
        !m.verified_at ||
        m.dispute_decision ||
        m.status !== "pending"
      )
        fail(409, "Спор не открыт. Обновите список.");
      const s = await this.free(t, m.specialist_id, true);
      if (!expectedOwner || String(s.owner_user_id) !== expectedOwner)
        fail(409, "Владелец изменился. Обновите список и проверьте решение.");
      if (decision === "transfer") {
        await t.query(
          `INSERT INTO rateus_private.revoked_owners VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [s.id, expectedOwner],
        );
        await t.query(
          `DELETE FROM rateus_private.master_identity WHERE specialist_id=$1 AND user_id=$2`,
          [s.id, expectedOwner],
        );
        await t.query(
          `UPDATE users SET specialist_id=NULL,role='client' WHERE id::text=$1 AND specialist_id=$2 AND role='specialist' AND email NOT ILIKE '%@who.kz'`,
          [expectedOwner, s.id],
        );
        await t.query("UPDATE specialists SET owner_user_id=NULL WHERE id=$1", [
          s.id,
        ]);
        await t.query(
          "UPDATE rateus_private.master_claims SET reviewed_by=$2 WHERE claim_id=$1",
          [cid, admin],
        );
        await this.bind(t, cid, m.anon_id, true);
        const {
          rows: [newOwner],
        } = await t.query("SELECT owner_user_id FROM specialists WHERE id=$1", [
          s.id,
        ]);
        if (String(newOwner.owner_user_id) === expectedOwner)
          fail(409, "Заявитель уже владелец. Выберите «Оставить владельца».");
      } else
        await t.query(
          "UPDATE claim_requests SET status='rejected',resolved_at=now() WHERE id=$1",
          [cid],
        );
      await t.query(
        "UPDATE rateus_private.master_claims SET dispute_decision=$2,decision_by=$3,decision_at=now() WHERE claim_id=$1",
        [cid, decision, admin],
      );
      return { decision };
    });
  }
  async approve(cid: number, admin: string, manual: boolean) {
    return this.tx(async (t) => {
      const {
        rows: [m],
      } = await t.query(
        "SELECT * FROM rateus_private.master_claims WHERE claim_id=$1 FOR UPDATE",
        [cid],
      );
      if (!m)
        fail(
          409,
          "Нет подтверждения номера. Нужна новая заявка с WhatsApp-кодом.",
        );
      if (m.disputed_owner)
        fail(409, "Для спора выберите решение администратора");
      if (m.bound_user)
        return { notificationStatus: m.legacy ? "not_requested" : "queued" };
      if (m.needs_review || (await this.hasPrior(t, m.specialist_id))) {
        if (!manual)
          fail(409, "Сначала выполните ручную сверку старого доступа");
        await this.free(t, m.specialist_id);
        await t.query(
          "UPDATE rateus_private.master_claims SET reviewed_by=$2 WHERE claim_id=$1",
          [cid, admin],
        );
      }
      if (m.legacy) return { notificationStatus: "not_requested" }; // No historical outreach. Bind only on fresh OTP login.
      await this.bind(t, cid, m.anon_id, true);
      return { notificationStatus: "queued" };
    });
  }
}
