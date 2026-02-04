import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

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

        <div className="prose prose-neutral max-w-none space-y-6 text-foreground">
          <p className="text-muted-foreground">
            Дата вступления в силу: 1 февраля 2026 года
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Общие положения</h2>
            <p>
              Настоящая Политика конфиденциальности описывает, как сервис <strong>Rateus</strong> (далее — «Сервис», «мы») 
              собирает, использует и защищает персональные данные пользователей при использовании платформы 
              для записи к специалистам и оставления отзывов.
            </p>
            <p>
              Используя Сервис, вы соглашаетесь с условиями данной Политики конфиденциальности.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. Какие данные мы собираем</h2>
            <p>Мы можем собирать следующие персональные данные:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Имя</strong> — для идентификации при записи и в отзывах</li>
              <li><strong>Номер телефона</strong> — для связи и подтверждения записи</li>
              <li><strong>Email</strong> — для авторизации и уведомлений (при регистрации)</li>
              <li><strong>Текст отзыва</strong> — для публикации на странице специалиста</li>
              <li><strong>Оценка (рейтинг)</strong> — для формирования рейтинга специалиста</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. Источники получения данных</h2>
            <p>Персональные данные поступают к нам из следующих источников:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Прямые формы на сайте (запись, регистрация, отзывы)</li>
              <li>Интеграции с системами бронирования (Altegio и другие)</li>
              <li>Ссылки для отзывов, отправленные через мессенджеры</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4. Как мы используем данные</h2>
            <p>Собранные данные используются исключительно для:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Обеспечения работы сервиса записи к специалистам</li>
              <li>Публикации и отображения отзывов</li>
              <li>Формирования рейтинга специалистов</li>
              <li>Связи с пользователями по вопросам записи</li>
              <li>Улучшения качества сервиса</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">5. Защита данных</h2>
            <p>
              Мы принимаем необходимые технические и организационные меры для защиты ваших персональных данных 
              от несанкционированного доступа, изменения, раскрытия или уничтожения.
            </p>
            <p>
              <strong>Мы не продаём и не передаём ваши персональные данные третьим лицам</strong> в коммерческих целях.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6. Анонимность отзывов</h2>
            <p>
              При оставлении отзыва пользователь может выбрать анонимную публикацию. 
              В этом случае имя автора не будет отображаться публично, однако мы сохраняем информацию 
              для внутренних целей проверки достоверности отзывов.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7. Хранение данных</h2>
            <p>
              Персональные данные хранятся в течение срока, необходимого для достижения целей их обработки, 
              либо до момента отзыва согласия пользователем.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">8. Права пользователей</h2>
            <p>Вы имеете право:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Запросить информацию о ваших персональных данных</li>
              <li>Потребовать исправления неточных данных</li>
              <li>Потребовать удаления ваших данных</li>
              <li>Отозвать согласие на обработку данных</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9. Контактная информация</h2>
            <p>
              По всем вопросам, связанным с обработкой персональных данных, вы можете обратиться по адресу:
            </p>
            <p className="font-medium">
              <a href="mailto:support@rateus.kz" className="text-primary hover:underline">
                support@rateus.kz
              </a>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10. Изменения политики</h2>
            <p>
              Мы оставляем за собой право вносить изменения в настоящую Политику конфиденциальности. 
              Актуальная версия всегда доступна на данной странице.
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
