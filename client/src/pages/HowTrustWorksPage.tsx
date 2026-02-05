import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function HowTrustWorksPage() {
  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="text-3xl font-bold mb-8" data-testid="text-how-trust-works-title">
          Как формируется доверие в Rateus
        </h1>

        <div className="prose prose-neutral max-w-none space-y-8 text-foreground">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Только проверенные отзывы</h2>
            <p>
              Каждый отзыв в Rateus привязан к реальному визиту. Оставить отзыв можно только 
              после того, как специалист отметит визит завершённым и отправит клиенту 
              персональную ссылку.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Как считается рейтинг</h2>
            <p>
              Рейтинг — это средняя оценка по всем проверенным отзывам. Каждый отзыв 
              проходит автоматическую проверку на подлинность.
            </p>
          </section>

          <section id="rating-status" className="space-y-4 scroll-mt-8">
            <h2 className="text-xl font-semibold">Статус рейтинга</h2>
            <p>
              <strong>«Формируется»</strong> — у специалиста пока меньше 10 проверенных отзывов. 
              Рейтинг ещё не стабилен.
            </p>
            <p>
              <strong>«Сформированный рейтинг»</strong> — получено 10+ проверенных отзывов. 
              Рейтинг объективно отражает качество работы специалиста.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Защита от накруток</h2>
            <p>
              Система автоматически выявляет подозрительные отзывы: слишком быстрые, 
              дублирующиеся или от новых аккаунтов. Такие отзывы публикуются, 
              но не влияют на рейтинг.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Анонимность</h2>
            <p>
              Клиент может оставить отзыв анонимно. В этом случае его имя не будет 
              отображаться публично, но отзыв всё равно будет привязан к реальному визиту.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
