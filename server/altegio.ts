import { storage } from "./storage";
import { db } from "./db";
import { appConfig, bookings, reviews } from "@shared/schema";
import { eq } from "drizzle-orm";
import { normalizePhone, resolveClientIdentity, handlePhoneAppearedLater } from "./client-identity";

const ALTEGIO_BASE_URL = "https://api.alteg.io/api/v1";

const RETRY_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]; // 5min, 15min, 60min
const MAX_RETRIES = 3;

const BRANCH_CITY_MAP: Record<number, string> = {
  25692: "Алматы",
  37245: "Алматы",
  469919: "Алматы",
  766817: "Алматы",
  28196: "Астана",
  86692: "Астана",
  64381: "Караганда",
};

function getCityForBranch(companyId: number): string {
  return BRANCH_CITY_MAP[companyId] || "Алматы";
}

export const STAFF_ID_ALIASES: Record<number, { primaryStaffId: number; primaryCompanyId: number }> = {
  1394519: { primaryStaffId: 57457, primaryCompanyId: 37245 },
  2194088: { primaryStaffId: 57457, primaryCompanyId: 37245 },
  2668559: { primaryStaffId: 2668558, primaryCompanyId: 37245 },
  2982468: { primaryStaffId: 2982463, primaryCompanyId: 25692 },
  2874598: { primaryStaffId: 2874603, primaryCompanyId: 766817 },
};

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

let cachedDbConfig: AltegioConfig | null = null;
let dbConfigLoaded = false;

async function loadConfigFromDb(): Promise<AltegioConfig | null> {
  try {
    const rows = await db.select().from(appConfig);
    const configMap: Record<string, string> = {};
    for (const row of rows) {
      configMap[row.key] = row.value;
    }
    const partnerToken = configMap["ALTEGIO_PARTNER_TOKEN"];
    const userToken = configMap["ALTEGIO_USER_TOKEN"];
    const companyId = configMap["ALTEGIO_COMPANY_ID"];
    if (partnerToken && userToken && companyId) {
      console.log(`[ALTEGIO] Loaded config from database (app_config table)`);
      return { partnerToken, userToken, companyId: parseInt(companyId, 10) };
    }
    return null;
  } catch (err) {
    console.warn(`[ALTEGIO] Failed to load config from database:`, err);
    return null;
  }
}

export async function initAltegioConfig(): Promise<void> {
  if (getConfigFromEnv()) {
    console.log(`[ALTEGIO] Config loaded from environment variables`);
    dbConfigLoaded = true;
    return;
  }
  cachedDbConfig = await loadConfigFromDb();
  dbConfigLoaded = true;
  if (cachedDbConfig) {
    console.log(`[ALTEGIO] Config loaded from database fallback`);
  } else {
    console.warn(`[ALTEGIO] No config found in env vars or database`);
  }
}

export function clearConfigCache(): void {
  cachedDbConfig = null;
  dbConfigLoaded = false;
}

function getConfigFromEnv(): AltegioConfig | null {
  const partnerToken = process.env.ALTEGIO_PARTNER_TOKEN;
  const userToken = process.env.ALTEGIO_USER_TOKEN;
  const companyId = process.env.ALTEGIO_COMPANY_ID;
  if (!partnerToken || !userToken || !companyId) return null;
  return { partnerToken, userToken, companyId: parseInt(companyId, 10) };
}

function getConfig(): AltegioConfig | null {
  const envConfig = getConfigFromEnv();
  if (envConfig) return envConfig;
  if (cachedDbConfig) return cachedDbConfig;
  if (!dbConfigLoaded) {
    console.warn(`[ALTEGIO] Config not yet loaded - call initAltegioConfig() first`);
  }
  return null;
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

function getConfiguredCompanyIds(): number[] {
  const raw = process.env.ALTEGIO_COMPANY_ID || "";
  return raw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
}

async function fetchAllCompanyIds(): Promise<number[]> {
  const config = getConfig();
  if (!config) return [];

  const configured = getConfiguredCompanyIds();

  try {
    console.log(`[ALTEGIO] Discovering all branches via API...`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${ALTEGIO_BASE_URL}/companies?my=1&count=100`, {
      method: "GET",
      headers: getHeaders(config),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let result: any = null;
    try { result = await response.json(); } catch {}

    if (response.ok && result?.success && Array.isArray(result.data)) {
      const discovered = result.data.map((c: any) => c.id).filter((id: number) => id > 0);
      const merged = [...new Set([...configured, ...discovered])];
      console.log(`[ALTEGIO] Discovered ${discovered.length} branches: ${discovered.join(", ")}`);
      console.log(`[ALTEGIO] Total branches (configured + discovered): ${merged.join(", ")}`);
      return merged;
    } else {
      console.warn(`[ALTEGIO] Branch discovery failed (${response.status}), using configured IDs only: ${configured.join(", ")}`);
      return configured;
    }
  } catch (err: any) {
    console.warn(`[ALTEGIO] Branch discovery error: ${err.message}, using configured IDs only: ${configured.join(", ")}`);
    return configured;
  }
}

export async function fetchAltegioStaffList(): Promise<{ success: boolean; staff?: Array<{ id: number; name: string; avatar: string | null; specialization: string | null; companyId: number }>; companyId?: number; error?: string; errorType?: AltegioErrorType }> {
  const config = getConfig();
  if (!config) {
    return { success: false, error: "not_configured", errorType: "invalid_keys" };
  }

  const companyIds = await fetchAllCompanyIds();
  if (companyIds.length === 0) {
    return { success: false, error: "no_company_ids", errorType: "invalid_keys" };
  }

  const allStaff: Array<{ id: number; name: string; avatar: string | null; specialization: string | null; companyId: number }> = [];
  const errors: string[] = [];

  for (const cid of companyIds) {
    try {
      console.log(`[ALTEGIO] Fetching staff list for company ${cid}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${ALTEGIO_BASE_URL}/book_staff/${cid}`, {
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
          companyId: cid,
        }));
        console.log(`[ALTEGIO] Staff list loaded for company ${cid}: ${staffList.length} members`);
        allStaff.push(...staffList);
      } else {
        const errorType = classifyAltegioError(response.status, result);
        const errorMsg = result?.meta?.message || JSON.stringify(result).slice(0, 200);
        console.error(`[ALTEGIO] Staff list fetch failed for company ${cid}: ${response.status} (${errorType}) - ${errorMsg}`);
        errors.push(`Company ${cid}: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error(`[ALTEGIO] Staff list fetch error for company ${cid} (api_unavailable):`, err.message);
      errors.push(`Company ${cid}: ${err.message}`);
    }
  }

  if (allStaff.length > 0) {
    console.log(`[ALTEGIO] Total staff loaded across ${companyIds.length} companies: ${allStaff.length} members`);
    return { success: true, staff: allStaff, companyId: companyIds[0] };
  }

  return { success: false, error: errors.join("; "), errorType: "api_unavailable" };
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
    const staffCompanyId = (staff as any).companyId || config.companyId;

    const alreadyMapped = allSpecialists.find((s: any) => s.altegioStaffId === staff.id && s.altegioCompanyId === staffCompanyId);
    if (alreadyMapped) {
      skipped++;
      continue;
    }

    const mappedByStaffOnly = allSpecialists.find((s: any) => s.altegioStaffId === staff.id);
    if (mappedByStaffOnly && !(mappedByStaffOnly as any).altegioCompanyId) {
      try {
        await storage.updateSpecialist(mappedByStaffOnly.id, { altegioCompanyId: staffCompanyId } as any);
        console.log(`[ALTEGIO-AUTOMAP] Updated companyId=${staffCompanyId} for "${mappedByStaffOnly.name}" (id=${mappedByStaffOnly.id})`);
        mapped++;
      } catch (err: any) {
        errors.push(`Failed to update companyId for ${mappedByStaffOnly.id}: ${err.message}`);
      }
      continue;
    }

    if (mappedStaffIds.has(staff.id) && mappedByStaffOnly) {
      skipped++;
      continue;
    }

    const staffCity = getCityForBranch(staffCompanyId);

    const sameNameSameCity = allSpecialists.find((s: any) =>
      s.isActive && normalizeName(s.name) === staffNameNorm && s.city === staffCity
    );

    if (sameNameSameCity && mappedSpecialistIds.has(sameNameSameCity.id)) {
      if ((sameNameSameCity as any).altegioStaffId) {
        STAFF_ID_ALIASES[staff.id] = {
          primaryStaffId: (sameNameSameCity as any).altegioStaffId,
          primaryCompanyId: (sameNameSameCity as any).altegioCompanyId,
        };
        console.log(`[ALTEGIO-AUTOMAP] Same-city alias: "${staff.name}" (staffId=${staff.id}, company=${staffCompanyId}) → "${sameNameSameCity.name}" (id=${sameNameSameCity.id}, staffId=${(sameNameSameCity as any).altegioStaffId})`);
      }
      mappedStaffIds.add(staff.id);
      skipped++;
      continue;
    }

    let match = sameNameSameCity || allSpecialists.find((s: any) =>
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
          console.log(`[ALTEGIO-AUTOMAP] Multiple candidates for "${staff.name}" (id=${staff.id}, company=${staffCompanyId}), skipping auto-map`);
          errors.push(`Ambiguous match for "${staff.name}" (id=${staff.id}): ${candidates.map(c => c.name).join(", ")}`);
          continue;
        }
      }
    }

    if (!match) {
      try {
        const newSpecialist = await storage.createSpecialist({
          name: staff.name,
          specialty: staff.specialization || "Специалист",
          bio: "",
          imageUrl: staff.avatar || "",
          category: "barber",
          city: staffCity,
          status: "active",
          isActive: true,
          altegioStaffId: staff.id,
          altegioCompanyId: staffCompanyId,
          altegioConnectionStatus: "connected",
        } as any);
        mappedStaffIds.add(staff.id);
        mappedSpecialistIds.add(newSpecialist.id);
        console.log(`[ALTEGIO-AUTOMAP] Created new specialist "${staff.name}" (id=${newSpecialist.id}) from Altegio staff (staffId=${staff.id}, company=${staffCompanyId})`);
        mapped++;
      } catch (err: any) {
        const msg = `Failed to create specialist for Altegio staff "${staff.name}" (id=${staff.id}): ${err.message}`;
        console.error(`[ALTEGIO-AUTOMAP] ${msg}`);
        errors.push(msg);
      }
      continue;
    }

    try {
      await storage.updateSpecialist(match.id, {
        altegioStaffId: staff.id,
        altegioCompanyId: staffCompanyId,
        altegioConnectionStatus: "connected",
      } as any);
      (match as any).altegioStaffId = staff.id;
      (match as any).altegioCompanyId = staffCompanyId;
      mappedStaffIds.add(staff.id);
      mappedSpecialistIds.add(match.id);
      console.log(`[ALTEGIO-AUTOMAP] Mapped "${staff.name}" (staffId=${staff.id}, company=${staffCompanyId}) → specialist "${match.name}" (id=${match.id})`);
      mapped++;
    } catch (err: any) {
      const msg = `Failed to update specialist ${match.id}: ${err.message}`;
      console.error(`[ALTEGIO-AUTOMAP] ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`[ALTEGIO-AUTOMAP] Complete: ${mapped} mapped, ${skipped} already mapped, ${errors.length} unmatched`);

  await mergeDuplicateSpecialists();

  return { mapped, skipped, errors };
}

export async function mergeDuplicateSpecialists(): Promise<void> {
  const allSpecialists = await storage.getSpecialists();
  const active = allSpecialists.filter((s: any) => s.isActive);

  function normalizeName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, " ");
  }

  const groups: Record<string, typeof active> = {};
  for (const s of active) {
    const key = `${normalizeName(s.name)}|${s.city || 'Алматы'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }

  for (const key of Object.keys(groups)) {
    const members = groups[key];
    if (members.length <= 1) continue;

    const primary = members.reduce((a: any, b: any) => {
      const aBookings = (a as any).altegioStaffId ? 1 : 0;
      const bBookings = (b as any).altegioStaffId ? 1 : 0;
      if (aBookings !== bBookings) return aBookings > bBookings ? a : b;
      return a.id < b.id ? a : b;
    });

    const duplicates = members.filter((m: any) => m.id !== primary.id);
    
    for (const dup of duplicates) {
      console.log(`[MERGE-DUPLICATES] Merging "${dup.name}" (id=${dup.id}, staffId=${(dup as any).altegioStaffId}) → "${primary.name}" (id=${primary.id}, staffId=${(primary as any).altegioStaffId})`);

      try {
        const dupBookings = await db.select().from(bookings).where(eq(bookings.specialistId, dup.id));
        if (dupBookings.length > 0) {
          await db.update(bookings).set({ specialistId: primary.id }).where(eq(bookings.specialistId, dup.id));
          console.log(`[MERGE-DUPLICATES] Moved ${dupBookings.length} bookings from specialist ${dup.id} → ${primary.id}`);
        }

        const dupReviews = await db.select().from(reviews).where(eq(reviews.specialistId, dup.id));
        if (dupReviews.length > 0) {
          await db.update(reviews).set({ specialistId: primary.id }).where(eq(reviews.specialistId, dup.id));
          console.log(`[MERGE-DUPLICATES] Moved ${dupReviews.length} reviews from specialist ${dup.id} → ${primary.id}`);
        }

        await storage.updateSpecialist(dup.id, { isActive: false } as any);

        if ((dup as any).altegioStaffId && (primary as any).altegioStaffId) {
          STAFF_ID_ALIASES[(dup as any).altegioStaffId] = {
            primaryStaffId: (primary as any).altegioStaffId,
            primaryCompanyId: (primary as any).altegioCompanyId,
          };
        }

        console.log(`[MERGE-DUPLICATES] Deactivated duplicate specialist ${dup.id}`);
      } catch (err: any) {
        console.error(`[MERGE-DUPLICATES] Failed to merge specialist ${dup.id}: ${err.message}`);
      }
    }
  }
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
    customerPhone: string | null;
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
        client: { phone: booking.customerPhone || "", name: booking.customerName },
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
        client: { name: booking.customerName, phone: booking.customerPhone || "" },
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
    customerPhone: string | null;
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

export interface AltegioAppointmentRecord {
  id: number;
  company_id: number;
  staff_id: number;
  datetime: string;
  attendance: number;
  visit_attendance: number;
  deleted: boolean;
  client?: {
    id?: number;
    name?: string;
    phone?: string;
    email?: string;
  } | null;
  services?: Array<{
    id: number;
    title: string;
    cost: number;
  }>;
  comment?: string;
  seance_length?: number;
}

export async function fetchUpcomingAppointments(companyId: number, options?: { staffId?: number; startDate?: string; endDate?: string; page?: number; count?: number }): Promise<{ success: boolean; appointments?: AltegioAppointmentRecord[]; total?: number; error?: string }> {
  const config = getConfig();
  if (!config) return { success: false, error: "not_configured" };

  const params = new URLSearchParams();
  if (options?.staffId) params.set("staff_id", String(options.staffId));
  if (options?.startDate) params.set("start_date", options.startDate);
  if (options?.endDate) params.set("end_date", options.endDate);
  params.set("page", String(options?.page || 1));
  params.set("count", String(options?.count || 200));

  const url = `${ALTEGIO_BASE_URL}/records/${companyId}?${params.toString()}`;

  try {
    console.log(`[ALTEGIO-FETCH] Fetching appointments for company ${companyId}, staff=${options?.staffId || "all"}, range=${options?.startDate}..${options?.endDate}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      method: "GET",
      headers: getHeaders(config),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let result: any = null;
    try { result = await response.json(); } catch {}

    if (response.ok && result?.success && Array.isArray(result.data)) {
      const appointments = result.data as AltegioAppointmentRecord[];
      const totalCount = result.meta?.total_count;
      console.log(`[ALTEGIO-FETCH] Got ${appointments.length} appointments for company ${companyId} (total_count=${totalCount ?? 'unknown'})`);
      return { success: true, appointments, total: totalCount ?? undefined };
    }

    const errorMsg = result?.meta?.message || `HTTP ${response.status}`;
    console.error(`[ALTEGIO-FETCH] Error fetching appointments: ${errorMsg}`);
    return { success: false, error: errorMsg };
  } catch (err: any) {
    console.error(`[ALTEGIO-FETCH] Network error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function syncUpcomingAppointments(opts?: { onCompleted?: (bookingId: number, altegioInfo?: { staffId?: number; companyId?: number }) => Promise<any> }): Promise<{ imported: number; updated: number; skipped: number; errors: string[] }> {
  const config = getConfig();
  if (!config) {
    console.log("[ALTEGIO-SYNC-APPTS] Not configured, skipping");
    return { imported: 0, updated: 0, skipped: 0, errors: ["not_configured"] };
  }

  const allSpecialists = await storage.getSpecialists();
  const connectedSpecialists = allSpecialists.filter((s: any) => s.altegioStaffId && s.altegioCompanyId);

  if (connectedSpecialists.length === 0) {
    console.log("[ALTEGIO-SYNC-APPTS] No connected specialists, skipping");
    return { imported: 0, updated: 0, skipped: 0, errors: [] };
  }

  const companyIds = await fetchAllCompanyIds();
  if (companyIds.length === 0) {
    return { imported: 0, updated: 0, skipped: 0, errors: ["no_companies"] };
  }

  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const startDate = yesterday.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const companyId of companyIds) {
    let allAppointments: AltegioAppointmentRecord[] = [];
    let page = 1;
    const pageSize = 200;

    while (true) {
      const result = await fetchUpcomingAppointments(companyId, { startDate, endDate, count: pageSize, page });
      if (!result.success || !result.appointments) {
        errors.push(`company ${companyId} page ${page}: ${result.error}`);
        break;
      }
      allAppointments = allAppointments.concat(result.appointments);
      if (result.appointments.length < pageSize) {
        break;
      }
      if (result.total != null && allAppointments.length >= result.total) {
        break;
      }
      page++;
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[ALTEGIO-SYNC-APPTS] Company ${companyId}: fetched ${allAppointments.length} appointments (${page} pages)`);

    for (const appt of allAppointments) {
      if (appt.deleted) {
        if (appt.company_id === 28196) {
          console.log(`[ALTEGIO-SYNC-DELETED] appt=${appt.id} staff_id=${appt.staff_id} company=${appt.company_id} client=${appt.client?.name} date=${appt.datetime}`);
        }
        skipped++; continue;
      }
      if (appt.attendance === -1) {
        if (appt.company_id === 28196) {
          console.log(`[ALTEGIO-SYNC-CANCELLED] appt=${appt.id} staff_id=${appt.staff_id} company=${appt.company_id} client=${appt.client?.name} date=${appt.datetime}`);
        }
        skipped++; continue;
      }

      const existing = await storage.getBookingByAltegioId(appt.id);
      if (existing) {
        const apptTime = new Date(appt.datetime);
        const clientName = appt.client?.name || "Клиент Altegio";
        const clientPhone = appt.client?.phone || "";
        const altClientId = appt.client?.id ? Number(appt.client.id) : null;
        let didUpdate = false;

        if (appt.staff_id === 2879303 || appt.company_id === 28196) {
          console.log(`[ALTEGIO-SYNC-EXISTING] appt=${appt.id} staff_id=${appt.staff_id} company=${appt.company_id} client=${clientName} booking=${existing.id} status=${existing.status} attendance=${appt.attendance}`);
        }

        if (appt.staff_id && appt.staff_id !== existing.altegioStaffId) {
          let effectiveStaffId = appt.staff_id;
          let effectiveCompanyId = appt.company_id;
          const alias = STAFF_ID_ALIASES[appt.staff_id];
          if (alias) {
            effectiveStaffId = alias.primaryStaffId;
            effectiveCompanyId = alias.primaryCompanyId;
          }
          const matchedSpec = effectiveCompanyId
            ? connectedSpecialists.find((s: any) => s.altegioStaffId === effectiveStaffId && s.altegioCompanyId === effectiveCompanyId)
            : null;
          const newSpec = matchedSpec || connectedSpecialists.find((s: any) => s.altegioStaffId === effectiveStaffId);
          if (newSpec && newSpec.id !== existing.specialistId) {
            console.log(`[ALTEGIO-SYNC-REASSIGN] Booking ${existing.id} (${existing.customerName}): specialist ${existing.specialistId} → ${newSpec.id} (${newSpec.name}), staff_id ${existing.altegioStaffId} → ${appt.staff_id}`);
            await storage.updateBooking(existing.id, {
              specialistId: newSpec.id,
              altegioStaffId: appt.staff_id,
              updatedFrom: "altegio",
            } as any);
            didUpdate = true;
          } else if (!newSpec) {
            console.log(`[ALTEGIO-SYNC-REASSIGN] Booking ${existing.id}: staff_id changed to ${appt.staff_id} but no specialist match found, keeping specialist=${existing.specialistId}`);
          }
        }

        const existingApptTime = existing.appointmentTime ? new Date(existing.appointmentTime).getTime() : 0;
        const newApptTime = apptTime.getTime();
        if (newApptTime && Math.abs(existingApptTime - newApptTime) > 60000) {
          await storage.updateBooking(existing.id, {
            appointmentTime: apptTime,
            updatedFrom: "altegio",
          } as any);
          console.log(`[ALTEGIO-SYNC-TIME] Booking ${existing.id} (${existing.customerName}): time updated ${new Date(existingApptTime).toISOString()} → ${apptTime.toISOString()}`);
          didUpdate = true;
        }

        const needsNameUpdate = existing.customerName === "Клиент Altegio" && clientName !== "Клиент Altegio";
        if (needsNameUpdate) {
          const updateFields: any = {
            customerName: clientName,
            customerPhone: clientPhone || null,
            updatedFrom: "altegio",
          };
          if (altClientId && !existing.altegioClientId) {
            updateFields.altegioClientId = altClientId;
          }
          await storage.updateBooking(existing.id, updateFields);
          didUpdate = true;
        }

        if (clientPhone && (existing.isNewClient || !existing.normalizedPhone)) {
          await handlePhoneAppearedLater(existing.id, clientPhone);
          didUpdate = true;
        }

        const canTransitionToCompleted =
          appt.attendance === 1 &&
          (existing.status === "scheduled" || existing.status === "ready_to_complete" || existing.status === "payment_pending");
        if (canTransitionToCompleted) {
          await storage.updateBooking(existing.id, {
            status: "completed",
            visitTrustWeight: 1.0,
            updatedFrom: "altegio",
          });
          console.log(`[ALTEGIO-SYNC-STATUS] Booking ${existing.id} (${existing.customerName}): status ${existing.status} → completed (attendance=1 from Altegio, weight=1.0 cash/unknown)`);
          didUpdate = true;
          if (opts?.onCompleted) {
            await opts.onCompleted(existing.id, { staffId: appt.staff_id, companyId: appt.company_id });
          }
        } else if (existing.status === "completed" && appt.attendance === 1 && opts?.onCompleted) {
          await opts.onCompleted(existing.id, { staffId: appt.staff_id, companyId: appt.company_id });
        }

        if (didUpdate) {
          updated++;
        } else {
          skipped++;
        }
        continue;
      }

      let specialistId: number | null = null;
      if (appt.staff_id) {
        let effectiveStaffId = appt.staff_id;
        let effectiveCompanyId = appt.company_id;
        const alias = STAFF_ID_ALIASES[appt.staff_id];
        if (alias) {
          effectiveStaffId = alias.primaryStaffId;
          effectiveCompanyId = alias.primaryCompanyId;
        }
        const matched = effectiveCompanyId
          ? connectedSpecialists.find((s: any) => s.altegioStaffId === effectiveStaffId && s.altegioCompanyId === effectiveCompanyId)
          : null;
        const fallback = matched || connectedSpecialists.find((s: any) => s.altegioStaffId === effectiveStaffId);
        if (fallback) specialistId = fallback.id;
      }

      if (!specialistId) {
        if (appt.company_id === 28196 || appt.staff_id === 2879303) {
          console.log(`[ALTEGIO-SYNC-SKIP] No matched specialist for appt=${appt.id} staff_id=${appt.staff_id} company_id=${appt.company_id} client=${appt.client?.name} date=${appt.datetime}`);
        }
        skipped++;
        continue;
      }

      const appointmentTime = new Date(appt.datetime);
      const clientName = appt.client?.name || "Клиент Altegio";
      const clientPhone = appt.client?.phone || "";
      const altClientId = appt.client?.id ? Number(appt.client.id) : null;

      try {
        const identity = await resolveClientIdentity({
          altegioClientId: altClientId,
          phone: clientPhone || null,
          customerName: clientName,
          specialistId,
        });
        const newBooking = await storage.createBooking({
          specialistId,
          customerName: clientName,
          customerPhone: clientPhone || null,
          appointmentTime,
          status: "scheduled",
        } as any);

        let status: "scheduled" | "completed" = "scheduled";
        if (appt.attendance === 1) status = "completed";

        await storage.updateBooking(newBooking.id, {
          altegioAppointmentId: appt.id,
          altegioStaffId: appt.staff_id || null,
          altegioClientId: identity.altegioClientId,
          normalizedPhone: identity.normalizedPhone,
          isNewClient: identity.isNewClient,
          status,
          updatedFrom: "altegio",
          bookingSource: "altegio",
        });
        if (status === "completed" && opts?.onCompleted) {
          await opts.onCompleted(newBooking.id, { staffId: appt.staff_id, companyId: appt.company_id });
        }
        imported++;
      } catch (err: any) {
        errors.push(`appt ${appt.id}: ${err.message}`);
      }
    }
  }

  console.log(`[ALTEGIO-SYNC-APPTS] Complete: ${imported} imported, ${updated} updated, ${skipped} skipped, ${errors.length} errors`);
  return { imported, updated, skipped, errors };
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
