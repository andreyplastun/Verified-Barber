import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ChevronRight, Lock } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import {
  ACTIVATION_STEPS,
  getVisibleSteps,
  computeActivationScore,
  stepsUntilFirstReview,
  type ActivationStepKey,
  type CompletedSteps,
} from "@shared/activation";
import type { Specialist } from "@shared/schema";
import FirstReviewGuide from "./FirstReviewGuide";

const SUPPORT_PHONE = "77773000467";
const SUPPORT_TEXT =
  "Здравствуйте. Я зарегистрировался(ась) в Rateus и не понимаю что делать дальше. Помогите, пожалуйста.";

interface ActivationRow {
  selectedPath: string | null;
  completedSteps: CompletedSteps;
  activationScore: number;
  completedAt: string | null;
}

interface Props {
  specialist: Specialist | undefined;
  onScrollTo?: (anchor: string) => void;
  createdVisits?: number;
  onAddClient?: () => void;
}

function deriveSteps(
  specialist: Specialist,
  isAltegio: boolean,
  createdVisits: number,
): CompletedSteps {
  const s = specialist as any;
  return {
    photo: !!s.imageUrl && !String(s.imageUrl).includes("placeholder"),
    price: !!s.baseServicePrice && Number(s.baseServicePrice) > 0,
    // Altegio specialists have online booking wired automatically.
    contact: isAltegio || !!(s.bookingUrl || s.whatsapp || s.instagram || s.phone),
    add_client: isAltegio || createdVisits > 0,
    bio: !!s.bio && String(s.bio).trim().length > 0,
    first_review: (s.reviewCount || 0) >= 1,
  };
}

const STEP_ANCHORS: Record<ActivationStepKey, string | undefined> = {
  photo: "avatar-section",
  price: "price-section",
  contact: "contacts-section",
  add_client: undefined,
  bio: "bio-section",
  first_review: undefined,
};

export default function ActivationProgress({ specialist, onScrollTo, createdVisits = 0, onAddClient }: Props) {
  const { user } = useAuth();
  const [guideOpen, setGuideOpen] = useState(false);
  const reportedRef = useRef<Set<ActivationStepKey>>(new Set());
  const scoreReportedRef = useRef<number | null>(null);
  const completedFiredRef = useRef(false);
  const viewedRef = useRef(false);

  const isAltegio = !!(specialist as any)?.altegioStaffId;
  const firstReviewLocked = !isAltegio && createdVisits === 0;
  const showAddClientGuide = !isAltegio && createdVisits === 0;

  const { data: activation } = useQuery<ActivationRow>({
    queryKey: ["/api/activation/me"],
    enabled: !!user,
    queryFn: async () => {
      const res = await fetch("/api/activation/me", {
        headers: { "x-user-id": user!.id },
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const { data: example } = useQuery<{ specialist: { id: number; name: string } | null }>({
    queryKey: ["/api/onboarding/example-specialist"],
    enabled: !!user,
    queryFn: async () => {
      const res = await fetch("/api/onboarding/example-specialist", {
        headers: { "x-user-id": user!.id },
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const steps = useMemo<CompletedSteps>(
    () => (specialist ? deriveSteps(specialist, isAltegio, createdVisits) : {}),
    [specialist, isAltegio, createdVisits],
  );
  const score = useMemo(() => computeActivationScore(steps), [steps]);
  const stepsToReview = useMemo(() => stepsUntilFirstReview(steps), [steps]);
  const hasReview = !!steps.first_review;
  const visibleSteps = useMemo(() => getVisibleSteps({ isAltegio }), [isAltegio]);
  const firstIncomplete = useMemo<ActivationStepKey | null>(
    () =>
      visibleSteps.find((s) => {
        if (s.key === "first_review" && firstReviewLocked) return false;
        return !steps[s.key];
      })?.key ?? null,
    [visibleSteps, steps, firstReviewLocked],
  );

  // Sync to server when score changes (guard against duplicate POSTs in flight)
  const inFlightScoreRef = useRef<number | null>(null);
  useEffect(() => {
    if (!user || !specialist || activation === undefined) return;
    if (activation.activationScore === score) return;
    if (inFlightScoreRef.current === score) return;
    inFlightScoreRef.current = score;
    fetch("/api/activation/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": user.id },
      body: JSON.stringify({ completedSteps: steps, activationScore: score }),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/activation/me"] }))
      .catch(() => {})
      .finally(() => { inFlightScoreRef.current = null; });
  }, [score, user?.id, specialist?.id, activation?.activationScore, activation]);

  // Analytics
  useEffect(() => {
    if (!specialist) return;
    if (!viewedRef.current) {
      viewedRef.current = true;
      trackEvent("activation_step_viewed", { specialistId: specialist.id, value: String(score) });
    }
    for (const step of ACTIVATION_STEPS) {
      if (steps[step.key] && !reportedRef.current.has(step.key)) {
        reportedRef.current.add(step.key);
        trackEvent("activation_step_completed", { specialistId: specialist.id, value: step.key });
      }
    }
    if (scoreReportedRef.current !== score) {
      scoreReportedRef.current = score;
      trackEvent("activation_score_changed", { specialistId: specialist.id, value: String(score) });
    }
    if (score >= 100 && !completedFiredRef.current) {
      completedFiredRef.current = true;
      trackEvent("activation_completed", { specialistId: specialist.id });
    }
  }, [specialist, steps, score]);

  if (!specialist) return null;
  if (score >= 100) return null;

  const handleAddClient = () => {
    onAddClient?.();
    trackEvent("activation_add_client_started", { specialistId: specialist.id });
  };

  const handleViewPublic = () => {
    window.open(`/specialist/${specialist.id}`, "_blank", "noopener,noreferrer");
    trackEvent("activation_view_public_started", { specialistId: specialist.id });
  };

  const handleClick = (key: ActivationStepKey) => {
    if (steps[key]) return;
    if (key === "first_review") {
      if (firstReviewLocked) return;
      setGuideOpen(true);
      trackEvent("activation_first_review_started", { specialistId: specialist.id });
      return;
    }
    if (key === "add_client") {
      handleAddClient();
      return;
    }
    const anchor = STEP_ANCHORS[key];
    if (anchor && onScrollTo) onScrollTo(anchor);
  };

  const subtitle = isAltegio
    ? "Запись работает автоматически. Осталось получить первые отзывы."
    : firstReviewLocked
    ? "Добавьте клиента → отправьте ссылку → получите первый отзыв"
    : hasReview
    ? "Заполните профиль до конца"
    : createdVisits > 0
    ? "Ожидаем отзыв клиента"
    : stepsToReview > 0
    ? `До первого отзыва осталось ${stepsToReview} ${pluralizeSteps(stepsToReview)}`
    : "Добавьте клиента и отправьте ему ссылку на отзыв";

  return (
    <>
      <Card data-testid="activation-progress">
        <CardContent className="pt-5 pb-4">
          {showAddClientGuide && (
            <div
              className="mb-4 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-4"
              data-testid="card-first-review-guide"
            >
              <p className="text-sm font-semibold text-foreground mb-2">Как получить первый отзыв</p>
              <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
                <li>Добавьте клиента</li>
                <li>После визита отправьте ему ссылку на отзыв</li>
                <li>Клиент оставит отзыв</li>
                <li>Отзыв появится в вашем профиле</li>
              </ol>
              <Button
                className="mt-3 w-full"
                onClick={handleAddClient}
                data-testid="button-add-first-client"
              >
                Добавить первого клиента
              </Button>
            </div>
          )}

          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="flex-1 min-w-0">
              <h3
                className="text-base font-semibold leading-tight"
                data-testid="text-activation-title"
              >
                {isAltegio ? "Запись подключена — получите отзывы" : "Как получить первый отзыв"}
              </h3>
              <p
                className="text-sm text-muted-foreground mt-0.5"
                data-testid="text-activation-subtitle"
              >
                {subtitle}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${score}%` }}
                data-testid="progress-activation-bar"
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0" data-testid="text-activation-percent">
              {score}%
            </span>
          </div>

          <ul className="mt-4 space-y-1">
            {visibleSteps.map(step => {
              const done = !!steps[step.key];
              const isFirstReview = step.key === "first_review";
              const isContact = step.key === "contact";
              const locked = isFirstReview && firstReviewLocked;

              const label =
                isContact && isAltegio && done ? "Способ записи настроен" : step.label;

              const caption =
                isContact && isAltegio && done
                  ? "Источник: Altegio"
                  : isFirstReview && locked
                  ? "Сначала добавьте первого клиента"
                  : isFirstReview && !done && !isAltegio && createdVisits > 0
                  ? "Ожидаем отзыв клиента"
                  : null;

              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => handleClick(step.key)}
                    disabled={done || locked}
                    className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors ${
                      done || locked
                        ? "text-muted-foreground cursor-default"
                        : "hover:bg-muted/60 active:bg-muted"
                    }`}
                    data-testid={`step-${step.key}`}
                  >
                    {locked ? (
                      <Lock className="w-5 h-5 text-muted-foreground shrink-0" />
                    ) : done ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <span className={`flex-1 text-sm ${done ? "line-through" : "font-medium"}`}>
                      {label}
                      {!step.required && (
                        <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                          (необязательно)
                        </span>
                      )}
                    </span>
                    {!done && !locked && isFirstReview && (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mr-1">
                        Как получить
                      </span>
                    )}
                    {!done && !locked && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                  {caption && (
                    <p className="pl-10 pr-2 -mt-1 mb-1 text-xs text-muted-foreground" data-testid={`caption-${step.key}`}>
                      {caption}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {isAltegio && (
            <div className="mt-3 rounded-lg bg-muted/50 p-3" data-testid="altegio-checklist-note">
              <p className="text-xs text-muted-foreground">
                Мы автоматически получили ссылку на онлайн-запись из Altegio. Клиенты смогут записываться через кнопку «Записаться».
              </p>
              <button
                type="button"
                onClick={handleViewPublic}
                className="mt-2 text-xs font-semibold text-primary hover:underline"
                data-testid="button-view-public-checklist"
              >
                Посмотреть как видят клиенты
              </button>
            </div>
          )}

          {firstIncomplete && (
            <Button
              className="mt-3 w-full"
              onClick={() => handleClick(firstIncomplete)}
              data-testid="button-continue-setup"
            >
              {firstIncomplete === "add_client" ? "Добавить первого клиента" : "Продолжить настройку"}
            </Button>
          )}

          {!showAddClientGuide && (
            <div className="mt-4 pt-3 border-t border-border" data-testid="rateus-flow">
              <p className="text-xs font-semibold text-foreground mb-2">Как работает Rateus</p>
              <ol className="space-y-1.5 text-sm">
                {[
                  "Запись клиента",
                  "Клиент получает ссылку на отзыв",
                  "Оставляет отзыв",
                  "Растёт ваша репутация",
                ].map((stepText, i, arr) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className={i === arr.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}>
                      {stepText}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1">
            {example?.specialist && (
              <a
                href={`/specialist/${example.specialist.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline"
                data-testid="link-view-example"
              >
                Посмотреть пример заполненного профиля
              </a>
            )}
            <a
              href={`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(SUPPORT_TEXT)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              data-testid="link-activation-support"
            >
              Нужна помощь?
            </a>
          </div>
        </CardContent>
      </Card>
      <FirstReviewGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}

function pluralizeSteps(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "шаг";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "шага";
  return "шагов";
}
