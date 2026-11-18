import Clarity from "@microsoft/clarity";
import { getAttribution } from "./attribution";
import { createEntryTracker } from "./clarity-entry";
import { createClarityAuthController, type ClarityIdentity } from "./clarity-auth";

const getEntryType = createEntryTracker();
const controller = createClarityAuthController({
  init: () => Clarity.init("z9alyos1az"),
  command: (command) => {
    // The npm wrapper does not expose these supported clarity-js commands.
    (window as unknown as { clarity?: (command: string) => void }).clarity?.(command);
  },
  tag: (key, value) => Clarity.setTag(key, value),
  identify: (id) => Clarity.identify(id),
  anonymousId: () => `visitor-${crypto.randomUUID()}`,
  restoreTags: () => {
    Clarity.setTag("entry_type", getEntryType(window.location.pathname, () => window.sessionStorage));
    updateClarityTags();
  },
});

// Capture entry before auth redirects without loading or calling Clarity.
export function initializeClarity() {
  if (typeof window === "undefined") return;
  getEntryType(window.location.pathname, () => window.sessionStorage);
  getAttribution();
}

export function syncClarityAuth(ready: boolean, user: ClarityIdentity) {
  if (!import.meta.env.PROD || typeof window === "undefined") return;
  const host = window.location.hostname;
  if (host !== "rateus.kz" && !host.endsWith(".rateus.kz")) return;
  try {
    controller.sync(ready, user);
  } catch (error) {
    console.warn("[Clarity] Initialization failed", error);
  }
}

export function updateClarityTags() {
  if (!controller.isActive()) return;
  try {
    const utm = getAttribution();
    for (const field of ["source", "medium", "campaign", "content"] as const) {
      // Clear previous campaign values when a newly tagged visit omits a field.
      Clarity.setTag(`utm_${field}`, utm[field] || "");
    }
  } catch (error) {
    console.warn("[Clarity] Could not set campaign tags", error);
  }
}

export function clarityEvent(name: "create_profile_click" | "find_in_catalog_click" | "specialist_signup_complete") {
  if (!controller.isActive()) return;
  try {
    updateClarityTags();
    Clarity.event(name);
  } catch (error) {
    console.warn("[Clarity] Could not record event", error);
  }
}
