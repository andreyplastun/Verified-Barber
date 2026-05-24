type AnalyticsPayload = {
  specialistId?: number;
  bookingId?: number;
  magicLinkId?: number;
  value?: string;
  source?: string;
};

export function trackEvent(eventType: string, payload: AnalyticsPayload = {}) {
  try {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        ...payload,
        source: payload.source || "web",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break UX
  }
}

export function trackProfileView(specialistId: number) {
  trackEvent("profile_view", { specialistId });
}
