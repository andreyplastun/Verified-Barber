import Clarity from "@microsoft/clarity";
import { getAttribution } from "./attribution";

let initialized = false;

export function initializeClarity() {
  if (initialized || !import.meta.env.PROD || typeof window === "undefined") return;
  const host = window.location.hostname;
  if (host !== "rateus.kz" && !host.endsWith(".rateus.kz")) return;
  try {
    Clarity.init("z9alyos1az");
    initialized = true;
    updateClarityTags();
  } catch (error) {
    console.warn("[Clarity] Initialization failed", error);
  }
}

export function updateClarityTags() {
  if (!initialized) return;
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
  if (!initialized) return;
  try {
    updateClarityTags();
    Clarity.event(name);
  } catch (error) {
    console.warn("[Clarity] Could not record event", error);
  }
}
