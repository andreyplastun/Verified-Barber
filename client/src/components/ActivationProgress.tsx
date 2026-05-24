import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import type { Specialist } from "@shared/schema";

type StepKey = "avatar" | "contacts" | "bio" | "price" | "first_review";

interface Step {
  key: StepKey;
  label: string;
  done: boolean;
  scrollTo?: string;
}

interface Props {
  specialist: Specialist | undefined;
  onScrollTo?: (anchor: string) => void;
}

export default function ActivationProgress({ specialist, onScrollTo }: Props) {
  const reportedRef = useRef<Set<StepKey>>(new Set());
  const completedFiredRef = useRef(false);

  const steps: Step[] = !specialist ? [] : [
    {
      key: "avatar",
      label: "Добавить фото",
      done: !!specialist.imageUrl && !specialist.imageUrl.includes("placeholder"),
      scrollTo: "avatar-section",
    },
    {
      key: "contacts",
      label: "Добавить способ записи",
      done: !!(
        (specialist as any).bookingUrl ||
        (specialist as any).whatsapp ||
        (specialist as any).instagram ||
        specialist.phone
      ),
      scrollTo: "contacts-section",
    },
    {
      key: "bio",
      label: "Добавить описание",
      done: !!specialist.bio && specialist.bio.trim().length > 0,
      scrollTo: "bio-section",
    },
    {
      key: "price",
      label: "Добавить цену",
      done: !!specialist.baseServicePrice && specialist.baseServicePrice > 0,
      scrollTo: "price-section",
    },
    {
      key: "first_review",
      label: "Получить первый отзыв",
      done: (specialist.reviewCount || 0) >= 1,
    },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const total = steps.length;

  // Fire analytics: per-step completion + full activation
  useEffect(() => {
    if (!specialist) return;
    for (const s of steps) {
      if (s.done && !reportedRef.current.has(s.key)) {
        reportedRef.current.add(s.key);
        trackEvent("activation_step_completed", {
          specialistId: specialist.id,
          value: s.key,
        });
      }
    }
    if (doneCount === total && total > 0 && !completedFiredRef.current) {
      completedFiredRef.current = true;
      trackEvent("activation_completed", { specialistId: specialist.id });
    }
  }, [specialist, doneCount, total]);

  if (!specialist) return null;
  if (doneCount >= total) return null;

  const handleClick = (s: Step) => {
    if (s.done) return;
    if (s.scrollTo && onScrollTo) {
      onScrollTo(s.scrollTo);
    }
  };

  return (
    <Card data-testid="activation-progress">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold leading-tight" data-testid="text-activation-title">
              Заполните профиль — начните получать отзывы
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Осталось несколько шагов до запуска
            </p>
          </div>
          <span
            className="shrink-0 text-sm font-semibold tabular-nums px-2.5 py-1 rounded-full bg-muted text-foreground"
            data-testid="text-activation-count"
          >
            {doneCount}/{total}
          </span>
        </div>

        <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${(doneCount / total) * 100}%` }}
          />
        </div>

        <ul className="mt-4 space-y-1">
          {steps.map(s => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => handleClick(s)}
                disabled={s.done}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors ${
                  s.done
                    ? "text-muted-foreground cursor-default"
                    : "hover:bg-muted/60 active:bg-muted"
                }`}
                data-testid={`step-${s.key}`}
              >
                {s.done ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                )}
                <span
                  className={`flex-1 text-sm ${s.done ? "line-through" : "font-medium"}`}
                >
                  {s.label}
                </span>
                {!s.done && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
