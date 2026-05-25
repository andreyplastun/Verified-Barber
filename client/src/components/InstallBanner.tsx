import { useState, useEffect, useCallback } from "react";
import { X, Share, MoreVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STORAGE_KEYS = {
  shown: "installBannerEverShown",
  dismissed: "installBannerDismissed",
  installed: "installBannerInstalled",
};

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

// Show ONCE per device, EVER. Period.
// After the first appearance we immediately mark it as permanently dismissed,
// regardless of how the user closes it (tap X, close tab, swipe browser, etc).
function shouldShowBanner(): boolean {
  if (isStandalone()) return false;
  if (localStorage.getItem(STORAGE_KEYS.installed) === "true") return false;
  if (localStorage.getItem(STORAGE_KEYS.dismissed) === "permanent") return false;
  if (localStorage.getItem(STORAGE_KEYS.shown) === "true") return false;
  return true;
}

function detectPlatform(): "ios" | "android" | "other" {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}

function logEvent(event: string) {
  console.log(`[INSTALL_BANNER] ${event}`);
}

export function InstallBanner() {
  const [visible, setVisible] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    // Auto-detect actual PWA install (Android/Chrome fires this; harmless elsewhere)
    const onInstalled = () => {
      localStorage.setItem(STORAGE_KEYS.installed, "true");
      logEvent("appinstalled_event");
      setAnimateIn(false);
      setTimeout(() => setVisible(false), 300);
    };
    window.addEventListener("appinstalled", onInstalled);

    // Auto-detect when user opens via installed PWA shortcut (display-mode change)
    const mql = window.matchMedia("(display-mode: standalone)");
    const onModeChange = () => {
      if (mql.matches) onInstalled();
    };
    mql.addEventListener?.("change", onModeChange);

    if (!shouldShowBanner()) {
      return () => {
        window.removeEventListener("appinstalled", onInstalled);
        mql.removeEventListener?.("change", onModeChange);
      };
    }

    const timer = setTimeout(() => {
      setVisible(true);
      // Mark permanently shown the moment it appears. One-shot.
      localStorage.setItem(STORAGE_KEYS.shown, "true");
      localStorage.setItem(STORAGE_KEYS.dismissed, "permanent");
      logEvent("banner_shown_once_permanent");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimateIn(true));
      });
    }, 2500);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("appinstalled", onInstalled);
      mql.removeEventListener?.("change", onModeChange);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    // X = permanent dismiss. User clearly doesn't want the banner.
    logEvent("banner_dismissed_permanent");
    localStorage.setItem(STORAGE_KEYS.dismissed, "permanent");
    setAnimateIn(false);
    setTimeout(() => {
      setVisible(false);
    }, 300);
  }, []);

  const handleInstallClick = useCallback(() => {
    logEvent("banner_install_clicked");
    logEvent("install_help_opened");
    setShowSheet(true);
  }, []);

  const handleMarkedInstalled = useCallback(() => {
    logEvent("banner_marked_installed");
    localStorage.setItem(STORAGE_KEYS.installed, "true");
    setShowSheet(false);
    setAnimateIn(false);
    setTimeout(() => setVisible(false), 300);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setShowSheet(false);
  }, []);

  if (!visible) return null;

  const platform = detectPlatform();

  return (
    <>
      <div
        className={cn(
          "fixed left-0 right-0 z-40 transition-all duration-300 ease-out",
          "bottom-16 pb-safe",
          animateIn
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0"
        )}
        data-testid="install-banner"
      >
        <div className="mx-auto max-w-lg">
          <div
            className={cn(
              "relative mx-2 rounded-t-2xl border-t",
              "bg-background dark:bg-[#111111]",
              "border-[#eeeeee] dark:border-[#222222]",
              "shadow-[0_-4px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.3)]",
              "px-4 py-3"
            )}
          >
            {/* X moved to top-right corner ABOVE the card so the chat FAB (bottom-20 right-4) cannot cover it */}
            <button
              onClick={handleDismiss}
              className="absolute -top-3 right-3 z-10 w-8 h-8 rounded-full bg-background dark:bg-[#1a1a1a] border border-[#eeeeee] dark:border-[#222222] shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Закрыть"
              data-testid="button-install-dismiss"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-3 pr-2">
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold leading-tight text-foreground" data-testid="text-install-title">
                  Добавьте Rateus на главный экран
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-tight" data-testid="text-install-description">
                  Быстрый доступ к записям, отзывам и рейтингу
                </p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  variant="default"
                  className="rounded-xl text-[13px] font-medium h-9"
                  onClick={handleInstallClick}
                  data-testid="button-install-how"
                >
                  Как установить
                </Button>
                <button
                  onClick={handleMarkedInstalled}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                  data-testid="button-install-already"
                >
                  Уже установил
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showSheet && (
        <div className="fixed inset-0 z-50" data-testid="install-sheet">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleCloseSheet}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-background dark:bg-[#111111] rounded-t-2xl pb-safe animate-in slide-in-from-bottom duration-300">
            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full mx-auto mt-3 mb-2" />
            <div className="px-5 pb-6 max-h-[70vh] overflow-y-auto">
              <h2 className="text-lg font-bold text-foreground mb-4" data-testid="text-install-sheet-title">
                Как установить Rateus
              </h2>

              {(platform === "ios" || platform === "other") && (
                <div className="mb-5">
                  <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-muted text-xs font-bold">
                      iOS
                    </span>
                    Safari (iPhone / iPad)
                  </p>
                  <div className="space-y-3">
                    <Step
                      number={1}
                      icon={<Share className="w-4 h-4" />}
                      text='Нажмите кнопку «Поделиться»'
                    />
                    <Step
                      number={2}
                      icon={<Plus className="w-4 h-4" />}
                      text='Выберите «На экран Домой»'
                    />
                    <Step
                      number={3}
                      text='Нажмите «Добавить»'
                    />
                  </div>
                </div>
              )}

              {(platform === "android" || platform === "other") && (
                <div className="mb-5">
                  <p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-muted text-xs font-bold">
                      And
                    </span>
                    Chrome (Android)
                  </p>
                  <div className="space-y-3">
                    <Step
                      number={1}
                      icon={<MoreVertical className="w-4 h-4" />}
                      text="Нажмите меню ⋮"
                    />
                    <Step
                      number={2}
                      text='Выберите «Добавить на главный экран»'
                    />
                    <Step
                      number={3}
                      text="Подтвердите установку"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 mt-4">
                <Button
                  variant="default"
                  className="w-full rounded-xl"
                  onClick={handleCloseSheet}
                  data-testid="button-install-understood"
                >
                  Понятно
                </Button>
                <Button
                  variant="ghost"
                  className="w-full rounded-xl text-muted-foreground text-sm"
                  onClick={handleMarkedInstalled}
                  data-testid="button-install-already-installed"
                >
                  Уже установил
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Step({ number, icon, text }: { number: number; icon?: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0 mt-0.5">
        {number}
      </span>
      <div className="flex items-center gap-2 text-sm text-foreground leading-snug">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span>{text}</span>
      </div>
    </div>
  );
}
