import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

type ConfirmationStatus = "pending" | "confirmed" | "declined" | "expired" | "superseded";

type Confirmation = {
  status: ConfirmationStatus;
  specialistName: string;
  specialistImageUrl?: string | null;
  appointmentTime: string;
  reviewUrl?: string | null;
};

type ApiError = Error & { status?: number };

async function getConfirmation(token: string): Promise<Confirmation> {
  const response = await fetch(`/api/visit-confirmations/${encodeURIComponent(token)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || "Не удалось загрузить подтверждение") as ApiError;
    error.status = response.status;
    throw error;
  }
  return body;
}

async function respondToConfirmation(token: string, answer: "yes" | "no"): Promise<Confirmation> {
  const response = await fetch(`/api/visit-confirmations/${encodeURIComponent(token)}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || "Не удалось сохранить ответ") as ApiError;
    error.status = response.status;
    throw error;
  }
  return body;
}

function formatAppointmentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-KZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2 text-foreground" aria-label="Rateus">
      <span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-primary text-primary-foreground shadow-sm">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
      <span className="font-display text-[17px] font-bold tracking-[-0.04em]">rateus</span>
    </div>
  );
}

function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background px-5 py-8 text-foreground sm:px-6">
      <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-accent/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-72 w-72 rounded-full bg-secondary/70 blur-3xl" />
      <div className="relative z-10 w-full max-w-[430px] animate-in">{children}</div>
    </main>
  );
}

function StatusIcon({ tone = "soft", children }: { tone?: "soft" | "success" | "quiet" | "error"; children: React.ReactNode }) {
  const tones = {
    soft: "bg-accent text-accent-foreground",
    success: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    quiet: "bg-muted text-muted-foreground",
    error: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  };
  return <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] ${tones[tone]}`}>{children}</div>;
}

function TerminalScreen({
  icon,
  tone,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  tone?: "success" | "quiet" | "error";
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <ScreenShell>
      <div className="text-center">
        <BrandMark />
        <div className="mt-16">
          <StatusIcon tone={tone}>{icon}</StatusIcon>
          <h1 className="mt-7 font-display text-[29px] font-bold leading-[1.08] tracking-[-0.045em]">{title}</h1>
          <p className="mx-auto mt-4 max-w-[320px] text-[15px] leading-6 text-muted-foreground">{text}</p>
          {action && <div className="mt-8">{action}</div>}
        </div>
        <p className="mt-20 text-xs text-muted-foreground/70">Сервис подтверждения визитов Rateus</p>
      </div>
    </ScreenShell>
  );
}

export default function VisitConfirmationPage() {
  const [, params] = useRoute("/visit-confirm/:token");
  const [, setLocation] = useLocation();
  const token = params?.token || "";
  const [submitted, setSubmitted] = useState<Confirmation | null>(null);

  const confirmationQuery = useQuery<Confirmation, ApiError>({
    queryKey: ["/api/visit-confirmations", token],
    queryFn: () => getConfirmation(token),
    enabled: Boolean(token),
    retry: false,
  });

  const respondMutation = useMutation<Confirmation, ApiError, "yes" | "no">({
    mutationFn: (answer) => respondToConfirmation(token, answer),
    onSuccess: (result, answer) => {
      if (answer === "yes" && result.reviewUrl) {
        window.location.assign(result.reviewUrl);
        return;
      }
      setSubmitted(result);
    },
  });

  const confirmation = submitted || confirmationQuery.data;
  const displayTime = useMemo(
    () => (confirmation ? formatAppointmentTime(confirmation.appointmentTime) : ""),
    [confirmation],
  );

  if (!token || confirmationQuery.isError) {
    const isInvalid = !token || confirmationQuery.error?.status === 404;
    return (
      <TerminalScreen
        tone="error"
        icon={<AlertCircle className="h-7 w-7" />}
        title={isInvalid ? "Ссылка не найдена" : "Не удалось открыть ссылку"}
        text={
          isInvalid
            ? "Проверьте ссылку в сообщении WhatsApp. Возможно, она неполная или больше не существует."
            : "Проверьте подключение к интернету и попробуйте ещё раз."
        }
        action={
          !isInvalid ? (
            <button
              type="button"
              onClick={() => confirmationQuery.refetch()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-semibold shadow-sm transition-transform hover:bg-muted active:scale-[0.98]"
              data-testid="button-retry-confirmation"
            >
              <RefreshCw className="h-4 w-4" /> Попробовать ещё раз
            </button>
          ) : undefined
        }
      />
    );
  }

  if (confirmationQuery.isLoading) {
    return (
      <ScreenShell>
        <div className="animate-pulse">
          <div className="flex justify-center"><div className="h-8 w-24 rounded-lg bg-muted" /></div>
          <div className="mx-auto mt-16 h-16 w-16 rounded-[22px] bg-muted" />
          <div className="mx-auto mt-7 h-9 w-64 rounded-lg bg-muted" />
          <div className="mx-auto mt-4 h-12 w-72 rounded-lg bg-muted/80" />
          <div className="mt-9 rounded-2xl border border-border bg-card p-5"><div className="h-20 rounded-xl bg-muted" /></div>
        </div>
      </ScreenShell>
    );
  }

  if (!confirmation) return null;

  if (confirmation.status === "expired" || confirmation.status === "superseded") {
    return (
      <TerminalScreen
        tone="quiet"
        icon={<Clock3 className="h-7 w-7" />}
        title={confirmation.status === "expired" ? "Подтверждение устарело" : "Ссылка больше не действует"}
        text={
          confirmation.status === "expired"
            ? "Срок действия этого подтверждения визита закончился."
            : "Для этого визита уже создано другое подтверждение."
        }
      />
    );
  }

  if (confirmation.status === "confirmed" || (submitted && submitted.status === "confirmed")) {
    return (
      <TerminalScreen
        tone="success"
        icon={<CheckCircle2 className="h-7 w-7" />}
        title="Визит подтверждён"
        text={`Спасибо, что подтвердили визит к ${confirmation.specialistName}.`}
        action={
          confirmation.reviewUrl ? (
            <button
              type="button"
              onClick={() => window.location.assign(confirmation.reviewUrl!)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:opacity-90 active:scale-[0.98]"
              data-testid="button-open-review"
            >
              Оставить отзыв <ArrowRight className="h-4 w-4" />
            </button>
          ) : undefined
        }
      />
    );
  }

  if (confirmation.status === "declined") {
    return (
      <TerminalScreen
        tone="quiet"
        icon={<Check className="h-7 w-7" />}
        title="Ответ сохранён"
        text="Мы отметили, что визит не состоялся. Спасибо, что сообщили."
      />
    );
  }

  const isResponding = respondMutation.isPending;
  return (
    <ScreenShell>
      <div>
        <BrandMark />
        <div className="mt-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">Подтверждение визита</p>
          <h1 className="mt-3 font-display text-[30px] font-bold leading-[1.08] tracking-[-0.05em]">
            Вы были на приёме?
          </h1>
          <p className="mx-auto mt-4 max-w-[330px] text-[15px] leading-6 text-muted-foreground">
            Подтвердите информацию о визите, чтобы Rateus показывал только реальные отзывы.
          </p>
        </div>

        <section className="mt-8 overflow-hidden rounded-[24px] border border-border/80 bg-card shadow-[0_14px_40px_hsl(var(--primary)/0.06)]">
          <div className="flex items-center gap-4 border-b border-border/70 p-5">
            {confirmation.specialistImageUrl ? (
              <img
                src={confirmation.specialistImageUrl}
                alt=""
                className="h-14 w-14 rounded-[18px] object-cover"
                data-testid="img-specialist"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-secondary font-display text-lg font-bold text-secondary-foreground">
                {initials(confirmation.specialistName)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Специалист</p>
              <h2 className="mt-1 truncate font-display text-lg font-semibold">{confirmation.specialistName}</h2>
            </div>
          </div>
          <div className="flex items-start gap-3 p-5">
            <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground" />
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Дата и время</p>
              <p className="mt-1 text-[15px] font-semibold capitalize leading-6" data-testid="text-appointment-time">{displayTime}</p>
            </div>
          </div>
        </section>

        {respondMutation.isError && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4 text-sm leading-5 text-amber-800 dark:text-amber-300" role="alert" data-testid="text-response-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{respondMutation.error.message || "Ответ не сохранился. Попробуйте ещё раз."}</span>
          </div>
        )}

        <div className="mt-6 grid gap-3">
          <button
            type="button"
            onClick={() => respondMutation.mutate("yes")}
            disabled={isResponding}
            className="group flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_8px_20px_hsl(var(--primary)/0.16)] transition-transform hover:opacity-90 active:scale-[0.985] disabled:cursor-wait disabled:opacity-65"
            data-testid="button-confirm-yes"
          >
            {isResponding && respondMutation.variables === "yes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
            Да, я был(а)
          </button>
          <button
            type="button"
            onClick={() => respondMutation.mutate("no")}
            disabled={isResponding}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[15px] font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.985] disabled:cursor-wait disabled:opacity-65"
            data-testid="button-confirm-no"
          >
            {isResponding && respondMutation.variables === "no" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Нет, не был(а)
          </button>
        </div>
        <div className="mt-7 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-accent-foreground" />
          <span>Ваш ответ защищён и нужен для точности отзывов</span>
        </div>
      </div>
    </ScreenShell>
  );
}