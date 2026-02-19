import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const LS_KEYS = {
  client: "rateus_onboarding_seen_client",
  pro: "rateus_onboarding_seen_pro",
};

type OnboardingType = "client" | "pro";

export function useOnboardingSeen(type: OnboardingType) {
  const { user } = useAuth();
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    if (user) {
      const flag = type === "client" ? user.onboardingSeenClient : user.onboardingSeenPro;
      setSeen(flag);
    } else {
      const stored = localStorage.getItem(LS_KEYS[type]);
      setSeen(stored === "true");
    }
  }, [user, type]);

  const markSeen = useCallback(async () => {
    if (user) {
      try {
        await fetch(`/api/users/${user.id}/onboarding-seen`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user.id,
          },
          body: JSON.stringify({ type }),
        });
      } catch (err) {
        console.error("[ONBOARDING] Failed to save flag to server:", err);
      }
    }
    localStorage.setItem(LS_KEYS[type], "true");
    setSeen(true);
  }, [user, type]);

  return { seen, markSeen };
}
