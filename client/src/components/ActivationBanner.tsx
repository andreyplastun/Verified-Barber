import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Bell } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import type { Specialist } from "@shared/schema";
import { useAuth } from "@/contexts/AuthContext";

const LS_KEY = "rateus_activation_banner_dismissed_at";

interface Props {
  specialist: Specialist | undefined;
  onCta?: () => void;
}

export default function ActivationBanner({ specialist, onCta }: Props) {
  const { user } = useAuth();
  const [dismissedAt, setDismissedAt] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      return v ? parseInt(v, 10) : null;
    } catch { return null; }
  });

  const banner = useMemo(() => {
    if (!user?.createdAt || !specialist) return null;
    const reviewCount = specialist.reviewCount || 0;
    if (reviewCount >= 1) return null;
    const createdMs = new Date(user.createdAt).getTime();
    if (Number.isNaN(createdMs)) return null;
    const ageDays = (Date.now() - createdMs) / (24 * 36e5);
    // T+0..T+1 → welcome; T+1..T+7 → next step; T+7+ → off
    if (ageDays > 7) return null;
    return ageDays < 1
      ? {
          stage: "welcome" as const,
          title: "Добавьте первого клиента, чтобы получить первый отзыв.",
          cta: "Добавить первого клиента",
        }
      : {
          stage: "week" as const,
          title: "Отзывы появляются после первого визита. Добавьте клиента, чтобы запустить процесс.",
          cta: "Добавить клиента",
        };
  }, [user?.createdAt, specialist]);

  // Не показывать чаще 1 раза в сутки
  const recentlyDismissed = dismissedAt
    ? Date.now() - dismissedAt < 24 * 60 * 60 * 1000
    : false;

  useEffect(() => {
    if (banner && !recentlyDismissed) {
      trackEvent("activation_banner_shown", {
        specialistId: specialist?.id,
        value: banner.stage,
      });
    }
  }, [banner?.stage, recentlyDismissed]);

  if (!banner || recentlyDismissed) return null;

  const dismiss = () => {
    const now = Date.now();
    try { localStorage.setItem(LS_KEY, String(now)); } catch {}
    setDismissedAt(now);
  };

  const handleCta = () => {
    trackEvent("activation_banner_click", {
      specialistId: specialist?.id,
      value: banner.stage,
    });
    onCta?.();
    dismiss();
  };

  return (
    <Card
      className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900"
      data-testid={`activation-banner-${banner.stage}`}
    >
      <div className="p-4 flex items-start gap-3">
        <Bell className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{banner.title}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 bg-background"
            onClick={handleCta}
            data-testid="activation-banner-cta"
          >
            {banner.cta}
          </Button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground p-1 -m-1 rounded"
          aria-label="Закрыть"
          data-testid="activation-banner-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </Card>
  );
}
