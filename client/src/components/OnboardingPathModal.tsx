import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { queryClient } from "@/lib/queryClient";
import { Link2, Plus, Eye } from "lucide-react";

type Path = "altegio" | "manual" | "browse";

interface ExampleResp {
  specialist: { id: number; name: string } | null;
}

interface ActivationRow {
  selectedPath: string | null;
  dismissedAt: string | null;
}

export default function OnboardingPathModal() {
  const { user, refetchUser } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [submitting, setSubmitting] = useState<Path | null>(null);

  const { data: activation } = useQuery<ActivationRow>({
    queryKey: ["/api/activation/me"],
    enabled: !!user && user.role === "specialist" && user.onboardingCompleted === true,
    queryFn: async () => {
      const res = await fetch("/api/activation/me", {
        headers: { "x-user-id": user!.id },
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const shouldShow =
    !!user &&
    user.role === "specialist" &&
    user.onboardingCompleted === true &&
    activation !== undefined &&
    !activation.selectedPath &&
    !activation.dismissedAt;

  const { data: example } = useQuery<ExampleResp>({
    queryKey: ["/api/onboarding/example-specialist"],
    enabled: shouldShow,
    queryFn: async () => {
      const res = await fetch("/api/onboarding/example-specialist", {
        headers: user ? { "x-user-id": user.id } : {},
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const handleDismiss = async () => {
    if (!user) return;
    try {
      await fetch("/api/activation/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": user.id },
      });
      trackEvent("activation_banner_click", { value: "onboarding_path_dismissed" });
      await queryClient.invalidateQueries({ queryKey: ["/api/activation/me"] });
    } catch {}
  };

  useEffect(() => {
    if (shouldShow) {
      trackEvent("activation_banner_shown", { value: "onboarding_path_modal" });
    }
  }, [shouldShow]);

  if (!shouldShow) return null;

  const choose = async (path: Path) => {
    if (!user) return;
    setSubmitting(path);
    try {
      const res = await fetch("/api/activation/path", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": user.id },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error("Не удалось сохранить выбор");
      trackEvent("onboarding_path_selected", { value: path });
      await queryClient.invalidateQueries({ queryKey: ["/api/activation/me"] });
      await refetchUser();
      if (path === "altegio") {
        toast({ title: "Подключите Altegio в карточке ниже" });
      } else if (path === "manual") {
        toast({ title: "Создайте первый визит вручную" });
      } else if (path === "browse" && example?.specialist) {
        navigate(`/specialist/${example.specialist.id}`);
      }
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(null);
    }
  };

  const hasExample = !!example?.specialist;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={e => e.preventDefault()}
        data-testid="onboarding-path-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">Как вы работаете?</DialogTitle>
          <DialogDescription>
            Выберите сценарий, чтобы быстрее запустить профиль
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <PathCard
            icon={<Link2 className="w-5 h-5 text-blue-600" />}
            tint="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900"
            title="Работаю через Altegio"
            description="Автоматически собирать отзывы после визитов"
            cta="Подключить"
            loading={submitting === "altegio"}
            onClick={() => choose("altegio")}
            testId="path-altegio"
          />
          <PathCard
            icon={<Plus className="w-5 h-5 text-emerald-600" />}
            tint="bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
            title="Работаю без CRM"
            description="Создать первый визит вручную"
            cta="Начать"
            loading={submitting === "manual"}
            onClick={() => choose("manual")}
            testId="path-manual"
          />
          {hasExample && (
            <PathCard
              icon={<Eye className="w-5 h-5 text-amber-600" />}
              tint="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
              title="Пока просто смотрю"
              description="Посмотреть пример готового профиля"
              cta="Открыть пример"
              loading={submitting === "browse"}
              onClick={() => choose("browse")}
              testId="path-browse"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PathCard({
  icon, tint, title, description, cta, loading, onClick, testId,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  description: string;
  cta: string;
  loading: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`w-full flex items-start gap-3 p-4 rounded-xl border text-left transition-all hover:shadow-sm active:scale-[0.99] disabled:opacity-60 ${tint}`}
      data-testid={testId}
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <span className="shrink-0 text-xs font-semibold text-foreground/80 px-3 py-1.5 rounded-md bg-background/60 border border-border self-center">
        {loading ? "..." : cta}
      </span>
    </button>
  );
}
