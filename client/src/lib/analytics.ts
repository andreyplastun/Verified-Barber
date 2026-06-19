type AnalyticsPayload = {
  specialistId?: number;
  bookingId?: number;
  magicLinkId?: number;
  value?: string;
  source?: string;
};

// Persistent anonymous browser id — lets us count unique visitors without accounts.
function getAnonId(): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    let id = localStorage.getItem("rateus_anon_id");
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("rateus_anon_id", id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export function trackEvent(eventType: string, payload: AnalyticsPayload = {}) {
  try {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        ...payload,
        source: payload.source || "web",
        anonId: getAnonId(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break UX
  }
}

// Fire once per page load to measure real app visits.
export function trackAppOpen() {
  trackEvent("app_open", { source: "web" });
}

export function trackProfileView(specialistId: number) {
  trackEvent("profile_view", { specialistId });
}
