import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckSquare, Send, Star } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const steps = [
  {
    icon: CheckSquare,
    title: "Отметьте визит",
    description: "Создайте запись клиента в дашборде или подключите Altegio — визиты появятся автоматически.",
  },
  {
    icon: Send,
    title: "Клиент получит ссылку",
    description: "После завершения визита система сама отправит клиенту короткую ссылку для отзыва в WhatsApp.",
  },
  {
    icon: Star,
    title: "Получите первый отзыв",
    description: "Клиент оставит отзыв за 30 секунд. Это запустит ваш рейтинг и повысит позицию в каталоге.",
  },
];

export default function FirstReviewGuide({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-first-review-guide">
        <DialogHeader>
          <DialogTitle>Как получить первый отзыв</DialogTitle>
          <DialogDescription>
            Клиенты выбирают специалистов по отзывам. Запустите процесс за три шага.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 mt-2">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="flex gap-3" data-testid={`first-review-step-${i + 1}`}>
                <div className="shrink-0 w-9 h-9 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    {i + 1}. {s.title}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {s.description}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
