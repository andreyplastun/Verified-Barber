export type Attribution = Partial<Record<"source" | "medium" | "campaign" | "content", string>>;
const key = "rateus_landing_attribution";

// Latest explicitly tagged visit wins; untagged navigation retains attribution.
export function getAttribution(search = window.location.search): Attribution {
  const params = new URLSearchParams(search);
  const utm: Attribution = {};
  for (const field of ["source", "medium", "campaign", "content"] as const) {
    const value = params.get(`utm_${field}`) || (field === "source" ? params.get("utm") : null);
    if (value) utm[field] = value.slice(0, 200);
  }
  try {
    if (Object.keys(utm).length) sessionStorage.setItem(key, JSON.stringify(utm));
    else return JSON.parse(sessionStorage.getItem(key) || "{}");
  } catch { /* Storage may be blocked; URL attribution still works. */ }
  return utm;
}

export function registrationUrl(utm: Attribution) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(utm)) if (value) query.set(`utm_${key}`, value);
  return `/create-profile${query.size ? `?${query}` : ""}`;
}
