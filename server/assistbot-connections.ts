import { pool } from "./db";
import { normalizePhone, isValidKzPhone } from "./client-identity";
import type { Specialist, User, AssistbotConnectionRequest } from "@shared/schema";

export const ASSISTBOT_CONNECTION_CONSENT_SCOPE =
  "assistbot_connection:name,email,manager_phone,whatsapp";
export const ASSISTBOT_CONNECTION_CONSENT_VERSION = "1.0";
// Provider contract: PUT /api/web/index.php/order-integration/ with a
// partner_token. AssistBot returns only data.order_id; it does not confirm
// that the WhatsApp number is connected.
const ASSISTBOT_ORDER_URL = "https://lk.assistbot.ru/api/web/index.php/order-integration/";

export type AssistbotConnectionStatus =
  | "pending_partner_configuration"
  | "pending_submission"
  | "submitting"
  | "pending_provider"
  | "provider_error"
  | "submission_unknown"
  | "superseded";

export type AssistbotProviderOutcome = "accepted" | "rejected" | "unknown";

/**
 * The order endpoint has no idempotency key and returns only order_id. A
 * 4xx response is a known rejection and can be corrected/retried; 5xx and
 * successful responses without an order id leave the provider outcome
 * unknown and must never be reposted automatically.
 */
export function classifyAssistbotProviderHttp(
  httpStatus: number,
  orderId: number | null,
): AssistbotProviderOutcome {
  if (httpStatus >= 200 && httpStatus < 300 && Number.isInteger(orderId) && Number(orderId) > 0) {
    return "accepted";
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return "rejected";
  }
  return "unknown";
}

export function isAssistbotProvisioningEnabled(): boolean {
  return process.env.ASSISTBOT_PROVISIONING_ENABLED === "true";
}

export function isAssistbotServerProduction(): boolean {
  // This value is read by the running server. script/build.ts deliberately
  // does not define/bake NODE_ENV into the bundle.
  return process.env.NODE_ENV === "production";
}

export function canSubmitAssistbotProviderOrder(): boolean {
  return isAssistbotProvisioningEnabled() && isAssistbotServerProduction();
}

type ConnectionRow = AssistbotConnectionRequest;

export class AssistbotConnectionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = "assistbot_connection_error",
  ) {
    super(message);
    this.name = "AssistbotConnectionError";
  }
}

function configuredPartnerToken(): string | null {
  const token = process.env.ASSISTBOT_PARTNER_TOKEN?.trim();
  return token || null;
}

function toConnectionRow(row: any): ConnectionRow {
  return {
    id: Number(row.id),
    specialistId: Number(row.specialist_id),
    ownerUserId: String(row.owner_user_id),
    normalizedPhone: String(row.normalized_phone),
    providerLogin: String(row.provider_login),
    status: row.status as AssistbotConnectionStatus,
    providerOrderId: row.provider_order_id == null ? null : Number(row.provider_order_id),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    consentScope: String(row.consent_scope),
    consentVersion: String(row.consent_version),
    consentedAt: new Date(row.consented_at),
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    supersededAt: row.superseded_at ? new Date(row.superseded_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function publicRequest(row: ConnectionRow | null, partnerConfigured: boolean) {
  if (!row) {
    return {
      request: null,
      partnerConfigured,
    };
  }
  return {
    request: {
      id: row.id,
      specialistId: row.specialistId,
      phone: row.normalizedPhone,
      status: row.status,
      providerOrderId: row.providerOrderId,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      consentScope: row.consentScope,
      consentVersion: row.consentVersion,
      consentedAt: row.consentedAt,
      submittedAt: row.submittedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    partnerConfigured,
  };
}

export function getAssistbotProviderConfiguration() {
  return {
    partnerConfigured: Boolean(configuredPartnerToken()),
    provisioningEnabled: isAssistbotProvisioningEnabled(),
    productionSubmissionEnabled: isAssistbotServerProduction(),
    submissionEnabled: canSubmitAssistbotProviderOrder(),
  };
}

export function getAssistbotBookingPhone(specialist: Pick<Specialist, "whatsapp" | "phone">) {
  const alternate = typeof specialist.whatsapp === "string" ? specialist.whatsapp : null;
  const primary = typeof specialist.phone === "string" ? specialist.phone : null;
  return normalizePhone(alternate) || normalizePhone(primary);
}

async function recoverStaleSubmittingRequests(): Promise<void> {
  await pool.query(
    `UPDATE assistbot_connection_requests
        SET status = 'submission_unknown',
            error_code = 'stale_submitting',
            error_message = 'Отправка прервалась; результат нужно проверить вручную',
            updated_at = NOW()
      WHERE status = 'submitting'
        AND updated_at < NOW() - INTERVAL '10 minutes'`,
  );
}

export async function getCurrentAssistbotConnectionRequest(
  specialistId: number,
  normalizedPhone: string | null,
  ownerUserId?: string,
) {
  await recoverStaleSubmittingRequests();
  if (!normalizedPhone) {
    return publicRequest(null, Boolean(configuredPartnerToken()));
  }
  const result = await pool.query(
    `SELECT *
       FROM assistbot_connection_requests
      WHERE specialist_id = $1
        AND normalized_phone = $2
        AND status <> 'superseded'
        ${ownerUserId ? "AND owner_user_id = $3" : ""}
      ORDER BY id DESC
      LIMIT 1`,
    ownerUserId ? [specialistId, normalizedPhone, ownerUserId] : [specialistId, normalizedPhone],
  );
  const row = result.rows[0] ? toConnectionRow(result.rows[0]) : null;
  return publicRequest(row, Boolean(configuredPartnerToken()));
}

export async function invalidateAssistbotConnectionRequests(
  specialistId: number,
  nextPhone: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE assistbot_connection_requests
        SET status = 'superseded',
            superseded_at = NOW(),
            updated_at = NOW(),
            error_code = 'phone_changed',
            error_message = 'Номер WhatsApp изменён; эта заявка больше не является привязкой профиля'
      WHERE specialist_id = $1
        AND status <> 'superseded'
        AND ($2::text IS NULL OR normalized_phone <> $2)`,
    [specialistId, nextPhone],
  );
}

function providerLogin(specialistId: number, normalizedPhone: string): string {
  // The provider requires a unique login. Keep it tenant-scoped rather than
  // phone-scoped so a number change cannot create a second external account.
  // The argument remains part of the helper contract to make that decision
  // explicit at the call site.
  void normalizedPhone;
  return `rateus_${specialistId}`;
}

async function getRequestById(id: number, client = pool) {
  if (client === pool) await recoverStaleSubmittingRequests();
  const result = await client.query(
    `SELECT *
       FROM assistbot_connection_requests
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return result.rows[0] ? toConnectionRow(result.rows[0]) : null;
}

async function markRequest(
  id: number,
  status: AssistbotConnectionStatus,
  fields: { errorCode?: string | null; errorMessage?: string | null } = {},
) {
  const result = await pool.query(
    `UPDATE assistbot_connection_requests
        SET status = $2,
            error_code = $3,
            error_message = $4,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, status, fields.errorCode ?? null, fields.errorMessage ?? null],
  );
  return result.rows[0] ? toConnectionRow(result.rows[0]) : null;
}

async function claimRequestForSubmission(row: ConnectionRow): Promise<ConnectionRow | null> {
  const result = await pool.query(
    `UPDATE assistbot_connection_requests
        SET status = 'submitting',
            error_code = NULL,
            error_message = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('pending_partner_configuration', 'pending_submission', 'provider_error')
      RETURNING *`,
    [row.id],
  );
  return result.rows[0] ? toConnectionRow(result.rows[0]) : null;
}

async function submitProviderRequest(
  row: ConnectionRow,
  specialist: Specialist,
  owner: User | undefined,
): Promise<ConnectionRow> {
  const partnerToken = configuredPartnerToken();
  if (!partnerToken) {
    return (
      (await markRequest(row.id, "pending_partner_configuration", {
        errorCode: "partner_token_not_configured",
        errorMessage: "Интеграция AssistBot не настроена администратором",
      })) || row
    );
  }

  // Never mutate a provider account from a test/development process. The
  // request remains persisted and an operator can submit it from production.
  if (!isAssistbotProvisioningEnabled()) {
    return (
      (await markRequest(row.id, "pending_submission", {
        errorCode: "provisioning_disabled",
        errorMessage: "Заявка сохранена; ASSISTBOT_PROVISIONING_ENABLED не включён",
      })) || row
    );
  }

  if (!isAssistbotServerProduction()) {
    return (
      (await markRequest(row.id, "pending_submission", {
        errorCode: "non_production_guard",
        errorMessage: "Заявка сохранена; отправка провайдеру доступна только в production",
      })) || row
    );
  }

  const submitting = await claimRequestForSubmission(row);
  if (!submitting) {
    const current = await getRequestById(row.id);
    if (current && (current.status === "submitting" || current.status === "pending_provider")) {
      return current;
    }
    throw new AssistbotConnectionError("Заявка подключения не найдена", 404, "request_not_found");
  }

  const managerPhone = normalizePhone(specialist.phone) || row.normalizedPhone;
  const payload: Record<string, string> = {
    login: row.providerLogin,
    name: specialist.name,
    phone_connect: row.normalizedPhone,
    phone: managerPhone,
  };
  if (owner?.email) payload.email = owner.email;

  try {
    const response = await fetch(ASSISTBOT_ORDER_URL, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${partnerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const responseText = await response.text();
    let responseBody: any = null;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = null;
    }

    const orderId = Number(responseBody?.data?.order_id);
    const outcome = classifyAssistbotProviderHttp(response.status, orderId);
    if (outcome === "unknown" && response.status >= 500) {
      return (
        (await markRequest(row.id, "submission_unknown", {
          errorCode: `provider_http_${response.status}`,
          errorMessage: "AssistBot не подтвердил результат заявки. Повторная отправка заблокирована до ручной проверки.",
        })) || row
      );
    }
    if (outcome === "rejected") {
      return (
        (await markRequest(row.id, "provider_error", {
          errorCode: `provider_http_${response.status}`,
          errorMessage: "AssistBot не принял заявку. Попробуйте повторить позже.",
        })) || row
      );
    }
    if (outcome !== "accepted") {
      return (
        (await markRequest(row.id, "submission_unknown", {
          errorCode: "provider_response_missing_order_id",
          errorMessage: "AssistBot вернул неожиданный ответ; результат заявки нужно проверить вручную.",
        })) || row
      );
    }

    const result = await pool.query(
      `UPDATE assistbot_connection_requests
          SET status = 'pending_provider',
              provider_order_id = $2,
              submitted_at = NOW(),
              error_code = NULL,
              error_message = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [row.id, orderId],
    );
    return result.rows[0] ? toConnectionRow(result.rows[0]) : row;
  } catch (error) {
    console.error("[ASSISTBOT_CONNECTION] provider request failed:", error instanceof Error ? error.message : error);
    return (
      (await markRequest(row.id, "submission_unknown", {
        errorCode: "provider_submission_unknown",
        errorMessage: "Не удалось подтвердить результат отправки в AssistBot. Не повторяйте заявку без проверки администратором.",
      })) || row
    );
  }
}

async function createOrLoadRequest(
  specialist: Specialist,
  owner: User,
): Promise<ConnectionRow> {
  const normalizedPhone = getAssistbotBookingPhone(specialist);
  if (!normalizedPhone || !isValidKzPhone(normalizedPhone)) {
    throw new AssistbotConnectionError(
      "Сначала укажите корректный номер WhatsApp в профиле",
      400,
      "invalid_whatsapp_phone",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '1500ms'");
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`assistbot-connection:${specialist.id}:${normalizedPhone}`],
    );

    const existing = await client.query(
      `SELECT *
         FROM assistbot_connection_requests
        WHERE specialist_id = $1
          AND normalized_phone = $2
          AND status <> 'superseded'
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE`,
      [specialist.id, normalizedPhone],
    );
    if (existing.rows[0]) {
      if (String(existing.rows[0].owner_user_id) !== String(owner.id)) {
        throw new AssistbotConnectionError(
          "Эта заявка принадлежит другому владельцу профиля",
          409,
          "request_owned_by_another_user",
        );
      }
      await client.query("COMMIT");
      return toConnectionRow(existing.rows[0]);
    }

    const otherTenant = await client.query(
      `SELECT specialist_id
         FROM assistbot_connection_requests
        WHERE normalized_phone = $1
          AND status <> 'superseded'
        LIMIT 1`,
      [normalizedPhone],
    );
    if (otherTenant.rows[0] && Number(otherTenant.rows[0].specialist_id) !== specialist.id) {
      throw new AssistbotConnectionError(
        "Этот номер уже используется в другой заявке AssistBot",
        409,
        "phone_already_requested",
      );
    }

    const inserted = await client.query(
      `INSERT INTO assistbot_connection_requests (
         specialist_id, owner_user_id, normalized_phone, provider_login,
         status, consent_scope, consent_version, consented_at
       ) VALUES ($1, $2, $3, $4, 'pending_partner_configuration', $5, $6, NOW())
       RETURNING *`,
      [
        specialist.id,
        owner.id,
        normalizedPhone,
        providerLogin(specialist.id, normalizedPhone),
        ASSISTBOT_CONNECTION_CONSENT_SCOPE,
        ASSISTBOT_CONNECTION_CONSENT_VERSION,
      ],
    );
    await client.query("COMMIT");
    return toConnectionRow(inserted.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof AssistbotConnectionError) throw error;
    if ((error as any)?.code === "23505") {
      const winner = await pool.query(
        `SELECT *
           FROM assistbot_connection_requests
          WHERE specialist_id = $1
            AND normalized_phone = $2
            AND status <> 'superseded'
          ORDER BY id DESC
          LIMIT 1`,
        [specialist.id, normalizedPhone],
      );
      if (winner.rows[0] && String(winner.rows[0].owner_user_id) === String(owner.id)) {
        return toConnectionRow(winner.rows[0]);
      }
      throw new AssistbotConnectionError(
        "Этот номер уже используется в другой заявке AssistBot",
        409,
        "phone_already_requested",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function loadRequestContext(requestId: number) {
  const result = await pool.query(
    `SELECT r.*, s.id AS context_specialist_id, s.name AS context_specialist_name,
            s.phone AS context_specialist_phone, s.whatsapp AS context_whatsapp,
            u.email AS context_owner_email
       FROM assistbot_connection_requests r
       JOIN specialists s ON s.id = r.specialist_id
       LEFT JOIN users u ON u.id = r.owner_user_id
      WHERE r.id = $1
      LIMIT 1`,
    [requestId],
  );
  return result.rows[0] || null;
}

async function submitExistingRequest(requestId: number): Promise<ConnectionRow> {
  const context = await loadRequestContext(requestId);
  if (!context) {
    throw new AssistbotConnectionError("Заявка подключения не найдена", 404, "request_not_found");
  }
  const currentPhone =
    normalizePhone(context.context_whatsapp) || normalizePhone(context.context_specialist_phone);
  if (!currentPhone || currentPhone !== String(context.normalized_phone)) {
    await invalidateAssistbotConnectionRequests(Number(context.specialist_id), currentPhone);
    throw new AssistbotConnectionError(
      "Заявка устарела: специалист изменил номер WhatsApp",
      409,
      "request_superseded",
    );
  }
  const row = toConnectionRow(context);
  const specialist = {
    id: Number(context.specialist_id),
    name: String(context.context_specialist_name),
    phone: context.context_specialist_phone,
    whatsapp: context.context_whatsapp || context.context_specialist_phone,
  } as Specialist;
  const owner = context.context_owner_email
    ? ({ id: String(row.ownerUserId), email: String(context.context_owner_email) } as User)
    : undefined;
  return submitProviderRequest(row, specialist, owner);
}

export async function requestAssistbotConnection(
  specialist: Specialist,
  owner: User,
) {
  const row = await createOrLoadRequest(specialist, owner);
  let finalRow = row;

  if (row.status === "pending_provider") {
    return publicRequest(finalRow, Boolean(configuredPartnerToken()));
  }
  // A second click while the first request is in flight must not issue
  // another provider order.
  if (row.status === "submitting") {
    return publicRequest(finalRow, Boolean(configuredPartnerToken()));
  }
  if (row.status === "submission_unknown") {
    return publicRequest(finalRow, Boolean(configuredPartnerToken()));
  }

  finalRow = await submitProviderRequest(row, specialist, owner);
  return publicRequest(finalRow, Boolean(configuredPartnerToken()));
}

export async function resubmitAssistbotConnectionRequest(requestId: number) {
  const row = await getRequestById(requestId);
  if (!row || row.status === "superseded") {
    throw new AssistbotConnectionError("Заявка подключения не найдена или устарела", 404, "request_not_found");
  }
  if (row.status === "submission_unknown") {
    throw new AssistbotConnectionError(
      "Результат отправки неизвестен; повторная отправка заблокирована во избежание дубля",
      409,
      "submission_unknown",
    );
  }
  if (
    row.status !== "pending_partner_configuration" &&
    row.status !== "pending_submission" &&
    row.status !== "provider_error"
  ) {
    throw new AssistbotConnectionError(
      "Повторная отправка разрешена только для известного отклонения AssistBot",
      409,
      "retry_not_allowed",
    );
  }
  return publicRequest(
    await submitExistingRequest(requestId),
    Boolean(configuredPartnerToken()),
  );
}

export async function acknowledgeUnknownAssistbotConnectionRequest(requestId: number) {
  const row = await getRequestById(requestId);
  if (!row || row.status !== "submission_unknown") {
    throw new AssistbotConnectionError(
      "Нужна заявка с неподтверждённым результатом отправки",
      409,
      "request_not_unknown",
    );
  }
  const result = await pool.query(
    `UPDATE assistbot_connection_requests
        SET error_code = 'manual_reconciliation_reviewed',
            error_message = 'Проверка отмечена администратором; подключение не подтверждено автоматически',
            updated_at = NOW()
      WHERE id = $1
        AND status = 'submission_unknown'
      RETURNING *`,
    [requestId],
  );
  return publicRequest(
    result.rows[0] ? toConnectionRow(result.rows[0]) : row,
    Boolean(configuredPartnerToken()),
  );
}

export async function listAssistbotConnectionRequests() {
  await recoverStaleSubmittingRequests();
  const result = await pool.query(
    `SELECT r.id, r.specialist_id, r.owner_user_id, r.normalized_phone,
            r.provider_login, r.status, r.provider_order_id, r.error_code,
            r.error_message, r.consent_scope, r.consent_version,
            r.consented_at, r.submitted_at, r.superseded_at,
            r.created_at, r.updated_at, s.name AS specialist_name,
            u.email AS owner_email
       FROM assistbot_connection_requests r
       JOIN specialists s ON s.id = r.specialist_id
       LEFT JOIN users u ON u.id = r.owner_user_id
      ORDER BY r.updated_at DESC
      LIMIT 200`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    specialistId: Number(row.specialist_id),
    specialistName: String(row.specialist_name),
    ownerEmail: row.owner_email ? String(row.owner_email) : null,
    phone: String(row.normalized_phone),
    status: String(row.status),
    providerOrderId: row.provider_order_id == null ? null : Number(row.provider_order_id),
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    consentScope: String(row.consent_scope),
    consentVersion: String(row.consent_version),
    consentedAt: row.consented_at,
    submittedAt: row.submitted_at,
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}