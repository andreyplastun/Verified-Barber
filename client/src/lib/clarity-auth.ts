export type ClarityIdentity = { id: string; role: "admin" | "specialist" | "client" } | null;

export function createClarityAuthController(api: {
  init: () => void;
  command: (command: "stop" | "start") => void;
  tag: (key: string, value: string) => void;
  identify: (id: string) => void;
  restoreTags: () => void;
  anonymousId: () => string;
}) {
  let initialized = false;
  let active = false;
  let identity: string | undefined;
  return {
    isActive: () => active,
    sync(ready: boolean, user: ClarityIdentity) {
      if (!ready || user?.role === "admin") {
        if (active) {
          active = false;
          api.command("stop");
        }
        return;
      }
      const next = user?.role === "specialist" ? user.id : "visitor";
      if (active && identity === next) return;
      // Separate account transitions; do not leave a master's identity on a guest.
      if (active) {
        active = false;
        api.command("stop");
      }
      if (!initialized) {
        api.init();
        initialized = true;
      } else {
        api.command("start");
      }
      active = true;
      api.tag("role", user?.role === "specialist" ? "specialist" : "visitor");
      if (user?.role === "specialist") api.identify(user.id);
      else if (identity && identity !== "visitor") api.identify(api.anonymousId());
      identity = next;
      api.restoreTags();
    },
  };
}
