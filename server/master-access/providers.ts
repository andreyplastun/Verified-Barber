import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { PoolClient } from "pg";
import { supabaseAdmin } from "../supabase-storage";
import { getAssistBotToken, reserveOtpSlot } from "../whatsapp";
export interface Providers {
  sendCode(
    phone: string,
    code: string,
    requestId: string,
  ): Promise<{ id: string | null; status: number }>;
  existingOwner?(
    tx: PoolClient,
    phone: string,
  ): Promise<{ sid: number; userId: string } | null>;
  account(
    tx: PoolClient,
    phone: string,
  ): Promise<{ id: string; email: string }>;
  session(
    userId: string,
    phone: string,
  ): Promise<{ access_token: string; refresh_token: string }>;
}
export const providers: Providers = {
  async sendCode(phone, code, requestId) {
    if (process.env.NODE_ENV !== "production")
      throw Error("WhatsApp отключён в тестовой среде");
    const token = await getAssistBotToken();
    if (!token) throw Error("WhatsApp не настроен");
    if (!(await reserveOtpSlot(requestId, phone)))
      throw Error("Канал временно недоступен");
    // Do not use the legacy text logger for authentication secrets, or log response bodies.
    const r = await fetch("https://lk.assistbot.ru/api/web/index.php/sms/", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        destination_params: [{ id: `rateus_auth_${requestId}`, phone }],
        text: `Код Rateus: ${code}. Действует 10 минут. Никому не сообщайте код.`,
        salon: "",
        type: "sms",
      }),
    });
    const body = await r.json().catch(() => null);
    if (
      !r.ok ||
      !body ||
      typeof body !== "object" ||
      body.error ||
      body.errors ||
      body.success === false ||
      /^(error|fail|reject)/i.test(String(body.status))
    )
      throw Error("WhatsApp не подтвердил отправку");
    const id = body.message_id ?? body.id ?? body.data?.id;
    return {
      id: id == null ? null : String(id).slice(0, 150),
      status: r.status,
    };
  },
  async existingOwner(tx, phone) {
    if (process.env.NODE_ENV !== "production") return null;
    // Only the Auth service's verified number and both sides of current ownership count.
    const { rows } = await tx.query(
      `SELECT s.id AS sid,u.id::text AS uid FROM auth.users a JOIN users u ON u.id::text=a.id::text JOIN specialists s ON s.id=u.specialist_id AND s.owner_user_id::text=u.id::text WHERE u.role='specialist' AND u.email NOT ILIKE '%@who.kz' AND a.phone IN ($1,$2) AND a.phone_confirmed_at IS NOT NULL AND a.deleted_at IS NULL`,
      [phone, phone.slice(1)],
    );
    return rows.length === 1 ? { sid: rows[0].sid, userId: rows[0].uid } : null;
  },
  async account(tx, phone) {
    if (process.env.NODE_ENV !== "production")
      throw Error("Реальные аккаунты отключены в тестовой среде");
    if (!supabaseAdmin) throw Error("Нет сервиса авторизации");
    // Production uses the same Supabase project for Postgres and Auth. Only trust its confirmed phone.
    const lookup = async () =>
      (
        await tx.query(
          `SELECT id::text,email,phone_confirmed_at FROM auth.users WHERE phone IN ($1,$2) AND deleted_at IS NULL`,
          [phone, phone.slice(1)],
        )
      ).rows;
    let matches = await lookup();
    if (!matches.length) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        phone,
        phone_confirm: true,
        email: `master-${randomUUID()}@accounts.rateus.invalid`,
        email_confirm: true,
        app_metadata: { rateus_phone_account: true },
      });
      if (!error && data.user?.email)
        return { id: data.user.id, email: data.user.email };
      matches = await lookup(); // Safe recovery from a previous interrupted provision.
    }
    if (
      matches.length !== 1 ||
      !matches[0].phone_confirmed_at ||
      !matches[0].email ||
      /@who\.kz$/i.test(matches[0].email)
    )
      throw Error("Нужна ручная сверка аккаунта");
    return { id: matches[0].id, email: matches[0].email };
  },
  async session(id, phone) {
    if (process.env.NODE_ENV !== "production")
      throw Error("Реальные сессии отключены в тестовой среде");
    if (!supabaseAdmin) throw Error("Нет сервиса авторизации");
    const {
      data: { user },
    } = await supabaseAdmin.auth.admin.getUserById(id);
    if (
      !user?.email ||
      !user.phone_confirmed_at ||
      user.phone?.replace(/\D/g, "") !== phone.slice(1) ||
      /@who\.kz$/i.test(user.email)
    )
      throw Error("Нужна сверка аккаунта");
    // Server-only exchange after OTP; generateLink sends NO email. Never return the link.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });
    if (error || data.user.id !== id) throw Error("Не удалось создать вход");
    const client = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.VITE_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    const result = await client.auth.verifyOtp({
      token_hash: data.properties.hashed_token,
      type: "email",
    });
    const s = result.data.session;
    if (!s || s.user.id !== id) throw Error("Не удалось создать сессию");
    return { access_token: s.access_token, refresh_token: s.refresh_token };
  },
};
