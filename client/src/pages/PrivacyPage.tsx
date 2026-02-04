import { Link } from "wouter";
import { ArrowLeft, Mail } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="text-3xl font-bold mb-8" data-testid="text-privacy-title">
          Политика конфиденциальности
        </h1>

        <div className="prose prose-neutral max-w-none space-y-8 text-foreground">
          <p>
            Сервис Rateus обрабатывает персональные данные пользователей в рамках работы интеграции 
            с платформой Altegio и связанных сервисов записи и обратной связи.
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Какие данные мы получаем</h2>
            <p>В рамках интеграции с Altegio сервис может получать и обрабатывать:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>имя клиента</li>
              <li>номер телефона</li>
              <li>информацию о визите (дата, специалист)</li>
              <li>оценки и отзывы о специалистах</li>
              <li>технические данные, необходимые для корректной работы интеграции</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Цели обработки данных</h2>
            <p>Данные используются исключительно для:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>сбора отзывов после визита</li>
              <li>формирования рейтингов специалистов</li>
              <li>отображения отзывов клиентам</li>
              <li>улучшения качества сервиса и пользовательского опыта</li>
              <li>работы автоматических уведомлений и ссылок для обратной связи</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Анонимность и отображение данных</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Пользователь может оставить отзыв анонимно</li>
              <li>При выборе анонимности имя пользователя не отображается специалисту и другим клиентам</li>
              <li>Отзывы могут временно учитываться ограниченно в рамках антифрод-механизмов</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Передача данных третьим лицам</h2>
            <p>
              Rateus не продаёт и не передаёт персональные данные третьим лицам.
            </p>
            <p>
              Данные используются только в рамках работы сервиса и технических интеграций 
              (включая Altegio и сервисы уведомлений).
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Хранение и защита данных</h2>
            <p>
              Мы применяем разумные технические и организационные меры для защиты данных 
              от несанкционированного доступа, утраты или изменения.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Контакты</h2>
            <p>
              По всем вопросам, связанным с обработкой данных и работой интеграции, 
              вы можете связаться с нами:
            </p>
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <a href="mailto:support@rateus.kz" className="text-primary hover:underline font-medium">
                support@rateus.kz
              </a>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground">
          © 2026 Rateus. Все права защищены.
        </div>
      </div>
    </div>
  );
}
