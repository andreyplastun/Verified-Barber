import { supabase } from "./supabase";

/**
 * Wraps window.fetch so every same-origin /api request carries the
 * Supabase access token as Authorization: Bearer. The server verifies
 * this token and ignores the (spoofable) x-user-id header.
 */
const originalFetch = window.fetch.bind(window);

function isApiRequest(input: RequestInfo | URL): boolean {
  let url: string;
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.href;
  else url = input.url;

  if (url.startsWith("/api/") || url === "/api") return true;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api");
  } catch {
    return false;
  }
}

function isPublicClaimRead(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET") return false;
  try {
    const rawUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const path = new URL(rawUrl, window.location.origin).pathname;
    return /^\/api\/claim\/[^/]+$/.test(path);
  } catch {
    return false;
  }
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (!isApiRequest(input)) {
    return originalFetch(input, init);
  }
  // Claim validation is public. Do not let a stale Supabase session prevent
  // the claim page itself from loading.
  if (isPublicClaimRead(input, init)) {
    return originalFetch(input, init);
  }
  const providedHeaders = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  if (providedHeaders.has("Authorization")) {
    return originalFetch(input, init);
  }

  let token: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
  } catch {
    token = null;
  }

  if (!token) {
    return originalFetch(input, init);
  }

  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (input instanceof Request && !init) {
    return originalFetch(new Request(input, { headers }));
  }
  return originalFetch(input, { ...init, headers });
};

export {};
