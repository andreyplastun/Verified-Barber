import { CalendarCheck, History, Star } from "lucide-react";

const BENEFITS = [
  { icon: CalendarCheck, text: "Запись в пару кликов — данные сохраняются" },
  { icon: History, text: "История визитов всегда под рукой" },
  { icon: Star, text: "Отзыв прямо со страницы мастера, с правкой" },
] as const;

export function ClientBenefits({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border border-primary/20 bg-primary/5 p-4 ${className}`}
      data-testid="block-client-benefits"
    >
      <p className="text-sm font-semibold text-foreground mb-3">
        С аккаунтом удобнее
      </p>
      <ul className="space-y-2.5">
        {BENEFITS.map(({ icon: Icon, text }, i) => (
          <li
            key={i}
            className="flex items-start gap-2.5 text-sm text-muted-foreground"
            data-testid={`text-client-benefit-${i}`}
          >
            <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
