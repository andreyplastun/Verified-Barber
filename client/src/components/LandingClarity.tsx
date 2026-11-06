import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";

const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;

// Clarity has no documented, reliable SPA unload API. Leave the tracked
// document entirely before rendering any private/untracked route.
export function LandingClarity({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const allowed = path === "/specialists" || path === "/create-profile";
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded && !allowed) {
      window.location.reload();
      return;
    }
    if (!allowed || loaded || !projectId || !/^[a-z0-9]+$/i.test(projectId)) return;
    const w = window as unknown as { clarity?: { (...args: unknown[]): void; q?: unknown[][] } };
    w.clarity = w.clarity || Object.assign((...args: unknown[]) => {
      w.clarity!.q!.push(args);
    }, { q: [] as unknown[][] });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${projectId}`;
    document.head.appendChild(script);
    setLoaded(true);
  }, [allowed, loaded]);
  return loaded && !allowed ? null : children;
}
