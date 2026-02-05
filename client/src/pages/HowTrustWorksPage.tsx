import { Link } from "wouter";
import { ArrowLeft, CheckCircle, XCircle, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HowTrustWorksPage() {
  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="text-2xl font-bold mb-4" data-testid="text-how-trust-works-title">
          Как формируется доверие в Rateus
        </h1>

        <p className="text-muted-foreground mb-8">
          Rateus — это не сайт отзывов.<br />
          Это система доверия между клиентом и специалистом.
        </p>

        <div className="space-y-10">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Только после реального визита</h2>
            <p className="text-muted-foreground">
              Отзыв можно оставить только после оказанной услуги.
            </p>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4 text-red-500" />
                <span>не при записи</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4 text-red-500" />
                <span>не «по просьбе»</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4 text-red-500" />
                <span>не за скидку</span>
              </div>
            </div>
            <p className="text-sm font-medium">Только реальный опыт.</p>
          </section>

          <hr className="border-border" />

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Почему отзывы с именами</h2>
            <p className="text-muted-foreground">
              По умолчанию отзывы показываются с именем.
            </p>
            <p className="text-sm text-muted-foreground">
              Так:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
              <li>меньше накрутки</li>
              <li>больше доверия</li>
              <li>честнее картина</li>
            </ul>
            <p className="text-sm">
              👉 Анонимность можно включить в любой момент.
            </p>
          </section>

          <hr className="border-border" />

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Как считается рейтинг</h2>
            <p className="text-muted-foreground">
              Рейтинг — это не просто среднее из звёзд.
            </p>
            <p className="text-sm text-muted-foreground">
              Учитывается:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
              <li>количество отзывов</li>
              <li>стабильность оценок</li>
              <li>время и контекст</li>
            </ul>
            <p className="text-sm font-medium">
              Поэтому одинаковые оценки ≠ одинаковое доверие.
            </p>
          </section>

          <hr className="border-border" />

          {/* Section 4 - Rating Status */}
          <section id="rating-status" className="space-y-3 scroll-mt-8">
            <h2 className="text-lg font-semibold">Статус рейтинга</h2>
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#F1F5F9] text-[#475569]">
                  Формируется
                </span>
                <span className="text-sm text-muted-foreground">— данных пока мало</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                  Сформированный
                </span>
                <span className="text-sm text-muted-foreground">— рейтинг стабилен</span>
              </div>
            </div>
            <p className="text-sm">
              Статус показывает насколько можно доверять цифре.
            </p>
          </section>

          <hr className="border-border" />

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Про негативную обратную связь</h2>
            <p className="text-muted-foreground">
              Критика важна, но без публичного давления.
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
              <li>сигналы о дискомфорте</li>
              <li>не влияют напрямую на рейтинг</li>
              <li>видны только специалисту</li>
            </ul>
            <p className="text-sm font-medium">
              Это помогает улучшаться, а не «наказывать».
            </p>
          </section>

          <hr className="border-border" />

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Мы не удаляем отзывы</h2>
            <p className="text-muted-foreground">
              Если визит был — отзыв остаётся.
            </p>
            <p className="text-sm text-muted-foreground">
              Rateus:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
              <li>не продаёт удаление</li>
              <li>не правит рейтинг вручную</li>
            </ul>
            <p className="text-sm font-medium">
              Доверие не редактируется.
            </p>
          </section>

          <hr className="border-border" />

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Чем Rateus отличается</h2>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4 text-red-500" />
                <span>нет отзывов без визита</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4 text-red-500" />
                <span>нет массовой накрутки</span>
              </div>
            </div>
            <div className="space-y-1 text-sm mt-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                <span>есть контекст</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                <span>есть прозрачность</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                <span>есть осознанный выбор</span>
              </div>
            </div>
          </section>

          <hr className="border-border" />

          {/* Section 8 - Summary */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Коротко</h2>
            <p className="text-muted-foreground">
              Отзывы — это механика.<br />
              Доверие — это система.
            </p>
            <p className="text-sm font-medium">
              Rateus помогает выбирать специалистов осознанно.
            </p>
          </section>

          <hr className="border-border" />

          {/* CTA for specialists */}
          <section className="bg-muted/50 rounded-lg p-6 text-center space-y-4">
            <div className="flex justify-center">
              <UserPlus className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Вы специалист?</h2>
            <p className="text-muted-foreground text-sm">
              Добавьте себя и начните формировать доверие через реальную работу.
            </p>
            <Link href="/specialist-signup">
              <Button data-testid="button-specialist-signup-cta">
                Зарегистрироваться
              </Button>
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
