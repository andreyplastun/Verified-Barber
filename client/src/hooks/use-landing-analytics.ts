import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import type { Attribution } from "@/lib/attribution";

export function useLandingAnalytics(utm: Attribution) {
  useEffect(() => {
    const visitId = crypto.randomUUID();
    let elapsed = 0;
    let started: number | null = document.hidden ? null : performance.now();
    let depth = 0;
    let flushed = false;
    const scroll = () => {
      const height = document.documentElement.scrollHeight;
      const percent = Math.min(100, (window.scrollY + window.innerHeight) / Math.max(1, height) * 100);
      depth = Math.max(depth, Math.floor((percent + 0.1) / 25) * 25);
    };
    const flush = (exitReason: string) => {
      if (flushed) return;
      scroll();
      if (started !== null) elapsed += performance.now() - started;
      started = null;
      flushed = true;
      trackEvent("master_landing_exit", {
        source: utm.source || "direct",
        metadata: { utm, page: "/specialists", visitId, activeSeconds: Math.round(elapsed / 1000), scrollDepth: depth, exitReason },
      });
    };
    const visibility = () => {
      if (document.hidden) flush("hidden");
      else { started = performance.now(); flushed = false; }
    };
    const hide = () => flush("pagehide");
    const show = () => { if (!document.hidden) { started = performance.now(); flushed = false; } };
    trackEvent("master_landing_view", { source: utm.source || "direct", metadata: { utm, page: "/specialists", visitId } });
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      flush("navigation");
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [utm]);
}
