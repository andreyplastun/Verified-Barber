import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function OfferPage() {
  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="text-3xl font-bold mb-2" data-testid="text-offer-title">
          Оферта для специалистов Rateus
        </h1>
        <p className="text-sm text-muted-foreground mb-8">Версия 1.0 | Сайт: rateus.kz</p>

        <div className="prose prose-neutral max-w-none space-y-8 text-foreground">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Предмет оферты</h2>
            <p>Настоящая оферта определяет условия размещения профиля специалиста на платформе Rateus и использования сервиса для получения отзывов и формирования репутационного рейтинга.</p>
            <p>Принятие условий оферты (акцепт) осуществляется путём регистрации на платформе и/или размещения профиля специалиста.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. Условия размещения</h2>
            <p>Специалист, размещающий профиль на Rateus:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>подтверждает достоверность предоставленной информации</li>
              <li>соглашается на получение и публикацию отзывов от клиентов</li>
              <li>соглашается с алгоритмом формирования рейтинга</li>
              <li>обязуется самостоятельно оказывать услуги клиентам</li>
              <li>несёт полную ответственность за качество оказываемых услуг</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. Рейтинг и отзывы</h2>
            <p>Рейтинг специалиста формируется автоматически на основе отзывов пользователей и внутренних алгоритмов Rateus.</p>
            <p>Rateus вправе:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>модерировать отзывы</li>
              <li>ограничивать влияние отдельных отзывов на рейтинг</li>
              <li>изменять алгоритмы расчёта рейтинга</li>
              <li>скрывать отзывы, нарушающие правила сервиса</li>
            </ul>
            <p>Специалист понимает и принимает, что Rateus не обязан раскрывать детали алгоритмов формирования рейтинга.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4. Платежи и расчёты</h2>
            <p>Размещение профиля на Rateus является бесплатным.</p>
            <p>Rateus не участвует в расчётах между специалистом и клиентом.</p>
            <p>Специалист самостоятельно принимает оплату за свои услуги и несёт ответственность за выполнение налоговых обязательств.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">5. Интеграции</h2>
            <p>Rateus может интегрироваться с внешними системами записи (например, Altegio) для автоматического получения информации о визитах.</p>
            <p>Подключая интеграцию, специалист соглашается на обмен данными между Rateus и внешним сервисом в рамках функционирования платформы.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6. Ответственность сторон</h2>
            <p>Rateus не несёт ответственности за:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>качество услуг, оказываемых специалистом</li>
              <li>споры между специалистом и клиентом</li>
              <li>содержание отзывов, оставленных клиентами</li>
              <li>финансовые потери, связанные с изменением рейтинга</li>
            </ul>
            <p>Специалист несёт ответственность за достоверность предоставленной информации и качество оказываемых услуг.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7. Прекращение сотрудничества</h2>
            <p>Специалист вправе запросить удаление своего профиля, направив запрос на support@rateus.kz.</p>
            <p>Rateus вправе ограничить или удалить профиль специалиста в случае нарушения условий оферты, пользовательского соглашения или законодательства.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">8. Изменение условий</h2>
            <p>Rateus вправе изменять условия настоящей оферты.</p>
            <p>Новая редакция вступает в силу с момента публикации на сайте.</p>
            <p>Продолжение использования сервиса специалистом после публикации изменений означает принятие новых условий.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9. Применимое право</h2>
            <p>К настоящей оферте применяется законодательство Республики Казахстан.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10. Контакты</h2>
            <p>Email: <a href="mailto:support@rateus.kz" className="text-primary underline">support@rateus.kz</a></p>
            <p>Сайт: <a href="https://rateus.kz" className="text-primary underline">rateus.kz</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
