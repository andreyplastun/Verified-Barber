const ALTEGIO_BASE_URL = "https://api.alteg.io/api/v1";

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
    if (msg.includes("staff") || msg.includes("сотрудник") || msg.includes("company") || msg.includes("компан")) {
      return "staff_not_found";
    }
    return "staff_not_found";
  }

  if (httpStatus === 429) return "api_unavailable";

  return "unknown";
}

function classifyNetworkError(_err: Error): AltegioErrorType {
  return "api_unavailable";
}

export function isAltegioConfigured(): boolean {
  return getConfig() !== null;
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
    const errorType = classifyNetworkError(err);
    console.error(`[ALTEGIO-HEALTH] Network error:`, err.message);
    return { ok: false, errorType, errorDetail: err.message };
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
    const errorType = classifyNetworkError(err);
    console.error(`[ALTEGIO] Staff list fetch error (${errorType}):`, err.message);
    return { success: false, error: err.message, errorType };
  }
}

export async function createAltegioAppointment(
  staffId: number,
  clientName: string,
  clientPhone: string,
  datetime: Date,
  comment?: string,
  rateusbookingId?: number,
): Promise<{ success: boolean; altegioId?: number; error?: string }> {
  const config = getConfig();
  if (!config) {
    console.log("[ALTEGIO-SYNC] Not configured, skipping create");
    return { success: false, error: "not_configured" };
  }

  const companyId = staffId ? config.companyId : config.companyId;

  const body: AltegioAppointmentData = {
    staff_id: staffId,
    client: {
      phone: clientPhone,
      name: clientName,
    },
    datetime: datetime.toISOString(),
    save_if_busy: true,
    comment: comment || undefined,
  };

  if (rateusbookingId) {
    body.api_id = String(rateusbookingId);
  }

  try {
    console.log(`[ALTEGIO-SYNC] Creating appointment: staffId=${staffId}, client=${clientName}, datetime=${datetime.toISOString()}`);
    const response = await fetch(`${ALTEGIO_BASE_URL}/records/${companyId}`, {
      method: "POST",
      headers: getHeaders(config),
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      const altegioId = Array.isArray(result.data) ? result.data[0]?.id : result.data?.id;
      console.log(`[ALTEGIO-SYNC] Created appointment: altegioId=${altegioId}`);
      return { success: true, altegioId };
    } else {
      const errorMsg = result?.meta?.message || JSON.stringify(result).slice(0, 200);
      console.error(`[ALTEGIO-SYNC] Create failed: ${response.status} - ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (err: any) {
    console.error(`[ALTEGIO-SYNC] Create error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function updateAltegioAppointment(
  altegioAppointmentId: number,
  companyId: number | null,
  updates: {
    datetime?: Date;
    clientName?: string;
    clientPhone?: string;
    attendance?: number;
    comment?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) {
    console.log("[ALTEGIO-SYNC] Not configured, skipping update");
    return { success: false, error: "not_configured" };
  }

  const locationId = companyId || config.companyId;

  const body: Record<string, any> = {};
  if (updates.datetime) body.datetime = updates.datetime.toISOString();
  if (updates.clientName || updates.clientPhone) {
    body.client = {};
    if (updates.clientName) body.client.name = updates.clientName;
    if (updates.clientPhone) body.client.phone = updates.clientPhone;
  }
  if (updates.attendance !== undefined) body.attendance = updates.attendance;
  if (updates.comment) body.comment = updates.comment;

  try {
    console.log(`[ALTEGIO-SYNC] Updating appointment ${altegioAppointmentId}: ${JSON.stringify(body).slice(0, 200)}`);
    const response = await fetch(`${ALTEGIO_BASE_URL}/record/${locationId}/${altegioAppointmentId}`, {
      method: "PUT",
      headers: getHeaders(config),
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      console.log(`[ALTEGIO-SYNC] Updated appointment ${altegioAppointmentId}`);
      return { success: true };
    } else {
      const errorMsg = result?.meta?.message || JSON.stringify(result).slice(0, 200);
      console.error(`[ALTEGIO-SYNC] Update failed: ${response.status} - ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (err: any) {
    console.error(`[ALTEGIO-SYNC] Update error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function deleteAltegioAppointment(
  altegioAppointmentId: number,
  companyId: number | null,
): Promise<{ success: boolean; error?: string }> {
  const config = getConfig();
  if (!config) {
    console.log("[ALTEGIO-SYNC] Not configured, skipping delete");
    return { success: false, error: "not_configured" };
  }

  const locationId = companyId || config.companyId;

  try {
    console.log(`[ALTEGIO-SYNC] Deleting appointment ${altegioAppointmentId}`);
    const response = await fetch(`${ALTEGIO_BASE_URL}/record/${locationId}/${altegioAppointmentId}`, {
      method: "DELETE",
      headers: getHeaders(config),
    });

    if (response.status === 204 || response.ok) {
      console.log(`[ALTEGIO-SYNC] Deleted appointment ${altegioAppointmentId}`);
      return { success: true };
    } else {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const result = await response.json();
        errorMsg = result?.meta?.message || errorMsg;
      } catch {}
      console.error(`[ALTEGIO-SYNC] Delete failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (err: any) {
    console.error(`[ALTEGIO-SYNC] Delete error:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function completeAltegioAppointment(
  altegioAppointmentId: number,
  companyId: number | null,
): Promise<{ success: boolean; error?: string }> {
  return updateAltegioAppointment(altegioAppointmentId, companyId, {
    attendance: 1,
  });
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
  action: "create" | "update" | "cancel" | "complete",
): Promise<{ success: boolean; altegioId?: number; error?: string }> {
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

  switch (action) {
    case "create": {
      if (booking.altegioAppointmentId) {
        console.log(`[ALTEGIO-SYNC] Booking ${booking.id} already has altegioAppointmentId=${booking.altegioAppointmentId}, updating instead`);
        return syncBookingToAltegio(booking, specialist, "update");
      }
      const result = await createAltegioAppointment(
        specialist.altegioStaffId,
        booking.customerName,
        booking.customerPhone,
        new Date(booking.appointmentTime),
        undefined,
        booking.id,
      );
      return result;
    }
    case "update": {
      if (!booking.altegioAppointmentId) {
        console.log(`[ALTEGIO-SYNC] Booking ${booking.id} has no altegioAppointmentId, creating instead`);
        return syncBookingToAltegio(booking, specialist, "create");
      }
      const result = await updateAltegioAppointment(
        booking.altegioAppointmentId,
        specialist.altegioCompanyId || null,
        {
          datetime: new Date(booking.appointmentTime),
          clientName: booking.customerName,
          clientPhone: booking.customerPhone,
        },
      );
      return { success: result.success, error: result.error };
    }
    case "cancel": {
      if (!booking.altegioAppointmentId) {
        console.log(`[ALTEGIO-SYNC] Booking ${booking.id} has no altegioAppointmentId, nothing to cancel`);
        return { success: true };
      }
      return deleteAltegioAppointment(
        booking.altegioAppointmentId,
        specialist.altegioCompanyId || null,
      );
    }
    case "complete": {
      if (!booking.altegioAppointmentId) {
        console.log(`[ALTEGIO-SYNC] Booking ${booking.id} has no altegioAppointmentId, nothing to complete`);
        return { success: true };
      }
      return completeAltegioAppointment(
        booking.altegioAppointmentId,
        specialist.altegioCompanyId || null,
      );
    }
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
