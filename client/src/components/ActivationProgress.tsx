import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import {
  ACTIVATION_STEPS,
  computeActivationScore,
  remainingStepsCount,
  type ActivationStepKey,
  type CompletedSteps,
} from "@shared/activation";
import type { Specialist } from "@shared/schema";
import FirstReviewGuide from "./FirstReviewGuide";

interface ActivationRow {
  selectedPath: string | null;
  completedSteps: CompletedSteps;
  activationScore: number;
  completedAt: string | null;
}

interface Props {
  specialist: Specialist | undefined;
  onScrollTo?: (anchor: string) => void;
}

function deriveSteps(specialist: Specialist): CompletedSteps {
  const s = specialist as any;
  return {
    photo: !!s.imageUrl && !String(s.imageUrl).includes("placeholder"),
    price: !!s.baseServicePrice && Number(s.baseServicePrice) > 0,
    contact: !!(s.bookingUrl || s.whatsapp || s.instagram || s.phone),
    bio: !!s.bio && String(s.bio).trim().length > 0,
    first_review: (s.reviewCount || 0) >= 1,
  };
}

const STEP_ANCHORS: Record<ActivationStepKey, string | undefined> = {
  photo: "avatar-section",
  price: "price-section",
  contact: "contacts-section",
  bio: "bio-section",
  first_review: undefined,
};

export default function ActivationProgress({ specialist, onScrollTo }: Props) {
  const { user } = useAuth();
  const [guideOpen, setGuideOpen] = useState(false);
  const reportedRef = useRef<Set<ActivationStepKey>>(new Set());
  const scoreReportedRef = useRef<number | null>(null);
  const completedFiredRef = useRef(false);
  const viewedRef = useRef(false);

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

  const steps = useMemo<CompletedSteps>(
    () => (specialist ? deriveSteps(specialist) : {}),
    [specialist],
  );
  const score = useMemo(() => computeActivationScore(steps), [steps]);
  const remaining = useMemo(() => remainingStepsCount(steps), [steps]);

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

  const handleClick = (key: ActivationStepKey) => {
    if (steps[key]) return;
    if (key === "first_review") {
      setGuideOpen(true);
      trackEvent("activation_first_review_started", { specialistId: specialist.id });
      return;
    }
    const anchor = STEP_ANCHORS[key];
    if (anchor && onScrollTo) onScrollTo(anchor);
  };

  return (
    <>
      <Card data-testid="activation-progress">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="flex-1 min-w-0">
              <h3
                className="text-base font-semibold leading-tight"
                data-testid="text-activation-title"
              >
                Профиль готов на {score}%
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-activation-remaining">
                {remaining > 0
                  ? `Ещё ${remaining} ${pluralizeSteps(remaining)} до полного профиля`
                  : "Все шаги выполнены"}
              </p>
            </div>
            <span
              className="shrink-0 text-sm font-semibold tabular-nums px-2.5 py-1 rounded-full bg-muted text-foreground"
              data-testid="text-activation-score"
            >
              {score}%
            </span>
          </div>

          <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${score}%` }}
              data-testid="progress-activation-bar"
            />
          </div>

          <ul className="mt-4 space-y-1">
            {ACTIVATION_STEPS.map(step => {
              const done = !!steps[step.key];
              const isFirstReview = step.key === "first_review";
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => handleClick(step.key)}
                    disabled={done}
                    className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors ${
                      done
                        ? "text-muted-foreground cursor-default"
                        : "hover:bg-muted/60 active:bg-muted"
                    }`}
                    data-testid={`step-${step.key}`}
                  >
                    {done ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <span className={`flex-1 text-sm ${done ? "line-through" : "font-medium"}`}>
                      {step.label}
                      {!step.required && (
                        <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                          (необязательно)
                        </span>
                      )}
                    </span>
                    {!done && isFirstReview && (
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mr-1">
                        Как получить
                      </span>
                    )}
                    {!done && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>

          {!steps.first_review && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Клиенты начинают выбирать специалистов по отзывам. Попросите клиента оставить
                первый отзыв после визита.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  setGuideOpen(true);
                  trackEvent("activation_first_review_started", { specialistId: specialist.id });
                }}
                data-testid="button-first-review-guide"
              >
                Как получить →
              </Button>
            </div>
          )}
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
