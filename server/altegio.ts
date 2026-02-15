import { storage } from "./storage";

const ALTEGIO_BASE_URL = "https://api.alteg.io/api/v1";

const RETRY_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]; // 5min, 15min, 60min
const MAX_RETRIES = 3;

interface AltegioConfig {
  partnerToken: string;
  userToken: string;
  companyId: number;
}

interface AltegioAppointmentData {
  staff_id: number;
  client: {
    phone: string;
    name: string;
  };
  datetime: string;
  comment?: string;
  save_if_busy?: boolean;
  attendance?: number;
  api_id?: string;
}

function getConfig(): AltegioConfig | null {
  const partnerToken = process.env.ALTEGIO_PARTNER_TOKEN;
  const userToken = process.env.ALTEGIO_USER_TOKEN;
  const companyId = process.env.ALTEGIO_COMPANY_ID;

  if (!partnerToken || !userToken || !companyId) {
    return null;
  }

  return {
    partnerToken,
    userToken,
    companyId: parseInt(companyId, 10),
  };
}

function getHeaders(config: AltegioConfig) {
  return {
    "Accept": "application/vnd.api.v2+json",
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.partnerToken}, User ${config.userToken}`,
  };
}

export type AltegioErrorType = 
  | "token_expired"
  | "access_revoked"
  | "api_unavailable"
  | "invalid_keys"
  | "staff_not_found"
  | "unknown";

export interface AltegioHealthResult {
  ok: boolean;
  errorType?: AltegioErrorType;
  errorDetail?: string;
  httpStatus?: number;
}

export type SyncAction = "create" | "update" | "cancel" | "complete";

export interface SyncResult {
  success: boolean;
  altegioId?: number;
  error?: string;
  errorType?: "temporary" | "permanent";
  httpStatus?: number;
}

function classifyAltegioError(httpStatus: number, responseBody?: any): AltegioErrorType {
  const msg = (responseBody?.meta?.message || responseBody?.message || "").toLowerCase();

  if (httpStatus === 401) {
    if (msg.includes("expired") || msg.includes("истек") || msg.includes("session")) {
      return "token_expired";
    }
    if (msg.includes("revoke") || msg.includes("отозван") || msg.includes("deactivat") || msg.includes("blocked")) {
      return "access_revoked";
    }
    return "token_expired";
  }

  if (httpStatus === 403) {
    if (msg.includes("revoke") || msg.includes("forbidden") || msg.includes("deactivat") || msg.includes("blocked") || msg.includes("отключ")) {
      return "access_revoked";
    }
    if (msg.includes("invalid") || msg.includes("credentials") || msg.includes("token") || msg.includes("ключ")) {
      return "invalid_keys";
    }
    return "invalid_keys";
  }

  if (httpStatus >= 500 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
    return "api_unavailable";
  }

  if (httpStatus === 404) {
    return "staff_not_found";
  }

  if (httpStatus === 429) return "api_unavailable";

  return "unknown";
}

function isTemporaryError(httpStatus: number): boolean {
  if (httpStatus >= 500) return true;
  if (httpStatus === 429) return true;
  return false;
}

function isTemporaryNetworkError(_err: Error): boolean {
  return true;
}

function isPermanentError(httpStatus: number): boolean {
  return httpStatus === 401 || httpStatus === 403;
}

export function isAltegioConfigured(): boolean {
  return getConfig() !== null;
}

async function updateSpecialistConnectionStatus(specialistId: number, status: "connected" | "error") {
  try {
    await storage.updateSpecialist(specialistId, { altegioConnectionStatus: status } as any);
  } catch (err) {
    console.error(`[ALTEGIO-SYNC] Failed to update connection status for specialist ${specialistId}:`, err);
  }
}

export async function checkAltegioHealth(specialistStaffId?: number | null, specialistCompanyId?: number | null): Promise<AltegioHealthResult> {
  const config = getConfig();
  if (!config) {
    return { ok: false, errorType: "invalid_keys", errorDetail: "not_configured" };
  }

  const companyId = specialistCompanyId || config.companyId;

  try {
    console.log(`[ALTEGIO-HEALTH] Checking health for company ${companyId}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${ALTEGIO_BASE_URL}/book_staff/${companyId}`, {
      method: "GET",
      headers: getHeaders(config),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let body: any = null;
    try { body = await response.json(); } catch {}

    if (response.ok && body?.success) {
      if (specialistStaffId) {
        const staffList = body.data || [];
        const found = staffList.some((s: any) => s.id === specialistStaffId);
        if (!found) {
          console.log(`[ALTEGIO-HEALTH] Staff ID ${specialistStaffId} not found in ${staffList.length} staff members`);
          return { ok: false, errorType: "staff_not_found", httpStatus: 200, errorDetail: `Staff ID ${specialistStaffId} not found` };
        }
      }
      console.log(`[ALTEGIO-HEALTH] OK`);
      return { ok: true };
    }

    const errorType = classifyAltegioError(response.status, body);
    const detail = body?.meta?.message || `HTTP ${response.status}`;
    console.error(`[ALTEGIO-HEALTH] Error: ${errorType} (${response.status}) - ${detail}`);
    return { ok: false, errorType, httpStatus: response.status, errorDetail: detail };
  } catch (err: any) {
    console.error(`[ALTEGIO-HEALTH] Network error:`, err.message);
    return { ok: false, errorType: "api_unavailable", errorDetail: err.message };
  }
}

export async function fetchAltegioStaffList(): Promise<{ success: boolean; staff?: Array<{ id: number; name: string; avatar: string | null; specialization: string | null }>; companyId?: number; error?: string; errorType?: AltegioErrorType }> {
  const config = getConfig();
  if (!config) {
    return { success: false, error: "not_configured", errorType: "invalid_keys" };
  }

  try {
    console.log(`[ALTEGIO] Fetching staff list for company ${config.companyId}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${ALTEGIO_BASE_URL}/book_staff/${config.companyId}`, {
      method: "GET",
      headers: getHeaders(config),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let result: any = null;
    try { result = await response.json(); } catch {}

    if (response.ok && result?.success) {
      const staffList = (result.data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar || null,
        specialization: s.specialization || null,
      }));
      console.log(`[ALTEGIO] Staff list loaded: ${staffList.length} members`);
      return { success: true, staff: staffList, companyId: config.companyId };
    } else {
      const errorType = classifyAltegioError(response.status, result);
      const errorMsg = result?.meta?.message || JSON.stringify(result).slice(0, 200);
      console.error(`[ALTEGIO] Staff list fetch failed: ${response.status} (${errorType}) - ${errorMsg}`);
      return { success: false, error: errorMsg, errorType };
    }
  } catch (err: any) {
    console.error(`[ALTEGIO] Staff list fetch error (api_unavailable):`, err.message);
    return { success: false, error: err.message, errorType: "api_unavailable" };
  }
}

export async function autoMapAltegioStaff(): Promise<{ mapped: number; skipped: number; errors: string[] }> {
  const config = getConfig();
  if (!config) {
    console.log("[ALTEGIO-AUTOMAP] Altegio not configured, skipping auto-mapping");
    return { mapped: 0, skipped: 0, errors: [] };
  }

  const result = await fetchAltegioStaffList();
  if (!result.success || !result.staff) {
    console.error(`[ALTEGIO-AUTOMAP] Failed to fetch staff: ${result.error}`);
    return { mapped: 0, skipped: 0, errors: [result.error || "Failed to fetch staff"] };
  }

  const allSpecialists = await storage.getSpecialists();
  let mapped = 0;
  let skipped = 0;
  const errors: string[] = [];

  function normalizeName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, " ");
  }

  const mappedStaffIds = new Set<number>();
  const mappedSpecialistIds = new Set<number>();

  for (const s of allSpecialists as any[]) {
    if (s.altegioStaffId) {
      mappedStaffIds.add(s.altegioStaffId);
      mappedSpecialistIds.add(s.id);
    }
  }

  for (const staff of result.staff) {
    const staffNameNorm = normalizeName(staff.name);

    const alreadyMapped = allSpecialists.find((s: any) => s.altegioStaffId === staff.id);
    if (alreadyMapped) {
      if ((alreadyMapped as any).altegioCompanyId === config.companyId) {
        skipped++;
      } else {
        try {
          await storage.updateSpecialist(alreadyMapped.id, { altegioCompanyId: config.companyId } as any);
          console.log(`[ALTEGIO-AUTOMAP] Updated companyId for "${alreadyMapped.name}" (id=${alreadyMapped.id})`);
          mapped++;
        } catch (err: any) {
          errors.push(`Failed to update companyId for ${alreadyMapped.id}: ${err.message}`);
        }
      }
      continue;
    }

    if (mappedStaffIds.has(staff.id)) {
      skipped++;
      continue;
    }

    let match = allSpecialists.find((s: any) =>
      !mappedSpecialistIds.has(s.id) && normalizeName(s.name) === staffNameNorm
    );

    if (!match) {
      const staffFirstName = staffNameNorm.split(" ")[0];
      if (staffFirstName.length >= 4) {
        const candidates = allSpecialists.filter((s: any) => {
          if (mappedSpecialistIds.has(s.id)) return false;
          const specFirst = normalizeName(s.name).split(" ")[0];
          return specFirst === staffFirstName;
        });
        if (candidates.length === 1) {
          match = candidates[0];
        } else if (candidates.length > 1) {
          console.log(`[ALTEGIO-AUTOMAP] Multiple candidates for "${staff.name}" (id=${staff.id}), skipping auto-map`);
          errors.push(`Ambiguous match for "${staff.name}" (id=${staff.id}): ${candidates.map(c => c.name).join(", ")}`);
          continue;
        }
      }
    }

    if (!match) {
      const msg = `No specialist match for Altegio staff "${staff.name}" (id=${staff.id})`;
      console.log(`[ALTEGIO-AUTOMAP] ${msg}`);
      errors.push(msg);
      continue;
    }

    try {
      await storage.updateSpecialist(match.id, {
        altegioStaffId: staff.id,
        altegioCompanyId: config.companyId,
        altegioConnectionStatus: "connected",
      } as any);
      mappedStaffIds.add(staff.id);
      mappedSpecialistIds.add(match.id);
      console.log(`[ALTEGIO-AUTOMAP] Mapped "${staff.name}" (staffId=${staff.id}) → specialist "${match.name}" (id=${match.id})`);
      mapped++;
    } catch (err: any) {
      const msg = `Failed to update specialist ${match.id}: ${err.message}`;
      console.error(`[ALTEGIO-AUTOMAP] ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[ALTEGIO-AUTOMAP] Complete: ${mapped} mapped, ${skipped} already mapped, ${errors.length} unmatched`);
  return { mapped, skipped, errors };
}

async function makeAltegioRequest(
  url: string,
  method: string,
  body: any | null,
  logCtx: { action: SyncAction; bookingId: number; specialistId: number; retryCount: number },
): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
  const config = getConfig();
  if (!config) return { ok: false, status: 0, error: "not_configured" };

  const options: RequestInit = {
    method,
    headers: getHeaders(config),
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);

    let responseData: any = null;
    try { responseData = await response.json(); } catch {}

    console.log(
      `[ALTEGIO-SYNC] ${logCtx.action} booking=${logCtx.bookingId} specialist=${logCtx.specialistId} ` +
      `retry=${logCtx.retryCount} status=${response.status} ` +
      `type=${response.ok ? 'success' : (isPermanentError(response.status) ? 'permanent' : 'temporary')} ` +
      `body=${JSON.stringify(responseData).slice(0, 300)}`
    );

    if (response.ok || response.status === 204) {
      await updateSpecialistConnectionStatus(logCtx.specialistId, "connected");
      return { ok: true, status: response.status, data: responseData };
    }

    if (isPermanentError(response.status)) {
      await updateSpecialistConnectionStatus(logCtx.specialistId, "error");
    }

    const errorMsg = responseData?.meta?.message || `HTTP ${response.status}`;
    return { ok: false, status: response.status, data: responseData, error: errorMsg };
  } catch (err: any) {
    console.log(
      `[ALTEGIO-SYNC] ${logCtx.action} booking=${logCtx.bookingId} specialist=${logCtx.specialistId} ` +
      `retry=${logCtx.retryCount} type=temporary network_error=${err.message}`
    );
    return { ok: false, status: 0, error: err.message };
  }
}

export async function syncBookingToAltegio(
  booking: {
    id: number;
    specialistId: number;
    customerName: string;
    customerPhone: string;
    appointmentTime: Date;
    altegioAppointmentId?: number | null;
    status: string;
    updatedFrom?: string | null;
  },
  specialist: {
    altegioStaffId?: number | null;
    altegioCompanyId?: number | null;
  } | null,
  action: SyncAction,
): Promise<SyncResult> {
  if (!isAltegioConfigured()) {
    return { success: false, error: "not_configured" };
  }

  if (booking.updatedFrom === "altegio") {
    console.log(`[ALTEGIO-SYNC] Skipping sync for booking ${booking.id} - came from Altegio (loop protection)`);
    return { success: true };
  }

  if (!specialist?.altegioStaffId) {
    console.log(`[ALTEGIO-SYNC] Specialist ${booking.specialistId} has no altegioStaffId, skipping sync`);
    return { success: false, error: "no_altegio_staff_id" };
  }

  const config = getConfig()!;
  const companyId = specialist.altegioCompanyId || config.companyId;
  const logCtx = { action, bookingId: booking.id, specialistId: booking.specialistId, retryCount: 0 };

  switch (action) {
    case "create": {
      if (booking.altegioAppointmentId) {
        return syncBookingToAltegio(booking, specialist, "update");
      }
      const body: AltegioAppointmentData = {
        staff_id: specialist.altegioStaffId,
        client: { phone: booking.customerPhone, name: booking.customerName },
        datetime: new Date(booking.appointmentTime).toISOString(),
        save_if_busy: true,
        api_id: String(booking.id),
      };
      const result = await makeAltegioRequest(
        `${ALTEGIO_BASE_URL}/records/${companyId}`, "POST", body, logCtx
      );
      if (result.ok) {
        const altegioId = Array.isArray(result.data?.data) ? result.data.data[0]?.id : result.data?.data?.id;
        return { success: true, altegioId };
      }
      return {
        success: false,
        error: result.error,
        errorType: (result.status === 0 || isTemporaryError(result.status)) ? "temporary" : "permanent",
        httpStatus: result.status,
      };
    }

    case "update": {
      if (!booking.altegioAppointmentId) {
        return syncBookingToAltegio(booking, specialist, "create");
      }
      const body: Record<string, any> = {
        datetime: new Date(booking.appointmentTime).toISOString(),
        client: { name: booking.customerName, phone: booking.customerPhone },
      };
      const result = await makeAltegioRequest(
        `${ALTEGIO_BASE_URL}/record/${companyId}/${booking.altegioAppointmentId}`, "PUT", body, logCtx
      );
      if (result.ok) return { success: true };
      return {
        success: false,
        error: result.error,
        errorType: (result.status === 0 || isTemporaryError(result.status)) ? "temporary" : "permanent",
        httpStatus: result.status,
      };
    }

    case "cancel": {
      if (!booking.altegioAppointmentId) return { success: true };
      const result = await makeAltegioRequest(
        `${ALTEGIO_BASE_URL}/record/${companyId}/${booking.altegioAppointmentId}`, "DELETE", null, logCtx
      );
      if (result.ok) return { success: true };
      return {
        success: false,
        error: result.error,
        errorType: (result.status === 0 || isTemporaryError(result.status)) ? "temporary" : "permanent",
        httpStatus: result.status,
      };
    }

    case "complete": {
      if (!booking.altegioAppointmentId) return { success: true };
      const body = { attendance: 1 };
      const result = await makeAltegioRequest(
        `${ALTEGIO_BASE_URL}/record/${companyId}/${booking.altegioAppointmentId}`, "PUT", body, logCtx
      );
      if (result.ok) return { success: true };
      return {
        success: false,
        error: result.error,
        errorType: (result.status === 0 || isTemporaryError(result.status)) ? "temporary" : "permanent",
        httpStatus: result.status,
      };
    }

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

const pendingRetries = new Map<number, NodeJS.Timeout>();

export function cancelRetry(bookingId: number) {
  const timer = pendingRetries.get(bookingId);
  if (timer) {
    clearTimeout(timer);
    pendingRetries.delete(bookingId);
    console.log(`[ALTEGIO-SYNC] Cancelled retry for booking ${bookingId}`);
  }
}

export async function syncWithRetry(
  booking: {
    id: number;
    specialistId: number;
    customerName: string;
    customerPhone: string;
    appointmentTime: Date;
    altegioAppointmentId?: number | null;
    status: string;
    updatedFrom?: string | null;
  },
  specialist: {
    altegioStaffId?: number | null;
    altegioCompanyId?: number | null;
  } | null,
  action: SyncAction,
  retryCount: number = 0,
): Promise<SyncResult> {
  const result = await syncBookingToAltegio(booking, specialist, action);

  if (result.success) {
    cancelRetry(booking.id);
    const updateData: any = {
      updatedFrom: "rateus",
      altegioSyncStatus: "synced",
      altegioSyncError: null,
      altegioRetryCount: retryCount,
    };
    if (result.altegioId) {
      updateData.altegioAppointmentId = result.altegioId;
    }
    await storage.updateBooking(booking.id, updateData);
    return result;
  }

  if (result.error === "not_configured" || result.error === "no_altegio_staff_id") {
    return result;
  }

  if (result.errorType === "permanent") {
    cancelRetry(booking.id);
    await storage.updateBooking(booking.id, {
      updatedFrom: "rateus",
      altegioSyncStatus: "error",
      altegioSyncError: result.error || null,
      altegioRetryCount: retryCount,
    } as any);
    console.log(
      `[ALTEGIO-SYNC] Permanent error for booking ${booking.id}, action=${action}, error=${result.error} - no retry`
    );
    return result;
  }

  if (retryCount < MAX_RETRIES) {
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
    const nextRetry = retryCount + 1;

    await storage.updateBooking(booking.id, {
      updatedFrom: "rateus",
      altegioSyncStatus: "pending",
      altegioSyncError: result.error || null,
      altegioRetryCount: retryCount,
      altegioLastRetryAt: new Date(),
    } as any);

    console.log(
      `[ALTEGIO-SYNC] Scheduling retry ${nextRetry}/${MAX_RETRIES} for booking ${booking.id}, ` +
      `action=${action}, delay=${delay / 1000}s, error=${result.error}`
    );

    const timer = setTimeout(async () => {
      pendingRetries.delete(booking.id);
      try {
        const freshBooking = await storage.getBooking(booking.id);
        if (!freshBooking) {
          console.log(`[ALTEGIO-SYNC] Booking ${booking.id} deleted, skipping retry`);
          return;
        }
        if (freshBooking.status === "cancelled") {
          console.log(`[ALTEGIO-SYNC] Booking ${booking.id} cancelled, skipping retry`);
          return;
        }

        const spec = await storage.getSpecialist(freshBooking.specialistId);
        if (!spec || !(spec as any).altegioStaffId) {
          console.log(`[ALTEGIO-SYNC] Specialist disconnected for booking ${booking.id}, skipping retry`);
          await storage.updateBooking(booking.id, {
            altegioSyncStatus: "error",
            altegioSyncError: "Specialist disconnected",
          } as any);
          return;
        }

        await syncWithRetry(
          { ...freshBooking, appointmentTime: new Date(freshBooking.appointmentTime) },
          { altegioStaffId: (spec as any).altegioStaffId, altegioCompanyId: (spec as any).altegioCompanyId },
          action,
          nextRetry,
        );
      } catch (err) {
        console.error(`[ALTEGIO-SYNC] Retry ${nextRetry} error for booking ${booking.id}:`, err);
        await storage.updateBooking(booking.id, {
          altegioSyncStatus: "error",
          altegioSyncError: `Retry ${nextRetry} failed`,
          altegioRetryCount: nextRetry,
        } as any);
      }
    }, delay);

    pendingRetries.set(booking.id, timer);
    return result;
  }

  cancelRetry(booking.id);
  await storage.updateBooking(booking.id, {
    updatedFrom: "rateus",
    altegioSyncStatus: "error",
    altegioSyncError: result.error || "Max retries exceeded",
    altegioRetryCount: retryCount,
    altegioLastRetryAt: new Date(),
  } as any);

  console.log(
    `[ALTEGIO-SYNC] All ${MAX_RETRIES} retries exhausted for booking ${booking.id}, action=${action}, ` +
    `marking as failed. Error: ${result.error}`
  );

  return result;
}

export async function manualRetrySync(bookingId: number): Promise<SyncResult> {
  const booking = await storage.getBooking(bookingId);
  if (!booking) return { success: false, error: "Booking not found" };

  if (booking.status === "cancelled") {
    return { success: false, error: "Booking is cancelled" };
  }

  const specialist = await storage.getSpecialist(booking.specialistId);
  if (!specialist || !(specialist as any).altegioStaffId) {
    return { success: false, error: "Specialist not connected to Altegio" };
  }

  const action: SyncAction = booking.altegioAppointmentId
    ? (booking.status === "completed" ? "complete" : "update")
    : "create";

  console.log(`[ALTEGIO-SYNC] Manual retry for booking ${bookingId}, action=${action}`);

  await storage.updateBooking(bookingId, {
    altegioSyncStatus: "pending",
    altegioSyncError: null,
    altegioRetryCount: 0,
  } as any);

  return syncWithRetry(
    { ...booking, appointmentTime: new Date(booking.appointmentTime) },
    { altegioStaffId: (specialist as any).altegioStaffId, altegioCompanyId: (specialist as any).altegioCompanyId },
    action,
    0,
  );
}

export async function createAltegioAppointment(
  staffId: number,
  clientName: string,
  clientPhone: string,
  datetime: Date,
  comment?: string,
  rateusBookingId?: number,
): Promise<{ success: boolean; altegioId?: number; error?: string }> {
  const config = getConfig();
  if (!config) return { success: false, error: "not_configured" };

  const body: AltegioAppointmentData = {
    staff_id: staffId,
    client: { phone: clientPhone, name: clientName },
    datetime: datetime.toISOString(),
    save_if_busy: true,
    comment: comment || undefined,
  };
  if (rateusBookingId) body.api_id = String(rateusBookingId);

  try {
    const response = await fetch(`${ALTEGIO_BASE_URL}/records/${config.companyId}`, {
      method: "POST",
      headers: getHeaders(config),
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.ok && result.success) {
      const altegioId = Array.isArray(result.data) ? result.data[0]?.id : result.data?.id;
      return { success: true, altegioId };
    }
    const errorMsg = result?.meta?.message || JSON.stringify(result).slice(0, 200);
    return { success: false, error: errorMsg };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function completeAltegioAppointment(
  altegioAppointmentId: number,
  companyId: number | null,
): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) return { success: false, error: "not_configured" };

  const locationId = companyId || config.companyId;
  try {
    const response = await fetch(`${ALTEGIO_BASE_URL}/record/${locationId}/${altegioAppointmentId}`, {
      method: "PUT",
      headers: getHeaders(config),
      body: JSON.stringify({ attendance: 1 }),
    });
    const result = await response.json();
    if (response.ok && result.success) return { success: true };
    const errorMsg = result?.meta?.message || `HTTP ${response.status}`;
    return { success: false, error: errorMsg };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function deleteAltegioAppointment(
  altegioAppointmentId: number,
  companyId: number | null,
): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) return { success: false, error: "not_configured" };

  const locationId = companyId || config.companyId;
  try {
    const response = await fetch(`${ALTEGIO_BASE_URL}/record/${locationId}/${altegioAppointmentId}`, {
      method: "DELETE",
      headers: getHeaders(config),
    });
    if (response.status === 204 || response.ok) return { success: true };
    let errorMsg = `HTTP ${response.status}`;
    try { const result = await response.json(); errorMsg = result?.meta?.message || errorMsg; } catch {}
    return { success: false, error: errorMsg };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
