import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="text-3xl font-bold mb-2" data-testid="text-terms-title">
          Пользовательское соглашение Rateus
        </h1>
        <p className="text-sm text-muted-foreground mb-8">Версия 1.0 | Сайт: rateus.kz</p>

        <div className="prose prose-neutral max-w-none space-y-8 text-foreground">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Общие положения</h2>
            <p>Настоящее Пользовательское соглашение регулирует условия использования сервиса Rateus (далее — «Сервис»).</p>
            <p>Используя сайт rateus.kz, пользователь подтверждает, что ознакомился с условиями настоящего соглашения и принимает их полностью.</p>
            <p>Rateus предоставляет онлайн-платформу для:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>поиска специалистов</li>
              <li>публикации отзывов</li>
              <li>формирования репутационного рейтинга специалистов</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. Статус сервиса Rateus</h2>
            <p>Rateus является информационной платформой.</p>
            <p>Rateus:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>не оказывает услуги, представленные специалистами</li>
              <li>не является исполнителем услуг</li>
              <li>не является стороной договора между клиентом и специалистом</li>
            </ul>
            <p>Любые услуги оказываются непосредственно специалистами.</p>
            <p>Все отношения, возникающие в связи с оказанием услуг, возникают между клиентом и специалистом напрямую.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. Платежи</h2>
            <p>Rateus не принимает платежи клиентов за услуги специалистов.</p>
            <p>Оплата услуг осуществляется напрямую между клиентом и специалистом через сторонние платежные системы или иные способы оплаты.</p>
            <p>Rateus:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>не является платежным агентом</li>
              <li>не является платежным агрегатором</li>
              <li>не принимает и не хранит денежные средства пользователей</li>
            </ul>
            <p>Rateus не несет ответственности за:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>проведение платежей</li>
              <li>возвраты денежных средств</li>
              <li>финансовые споры между клиентом и специалистом</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4. Отзывы и рейтинг</h2>
            <p>Rateus предоставляет пользователям возможность публиковать отзывы о специалистах.</p>
            <p>Рейтинг специалиста формируется автоматически на основе:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>отзывов пользователей</li>
              <li>внутренних алгоритмов сервиса</li>
              <li>факторов доверия</li>
            </ul>
            <p>Rateus вправе:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>модерировать отзывы</li>
              <li>ограничивать их влияние на рейтинг</li>
              <li>удалять отзывы, нарушающие правила сервиса</li>
            </ul>
            <p>Rateus не гарантирует достоверность каждого отзыва, поскольку отзывы являются мнением пользователей.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">5. Модерация и управление отзывами</h2>
            <p>Rateus вправе по своему усмотрению:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>скрывать отзывы</li>
              <li>ограничивать их отображение</li>
              <li>изменять алгоритмы формирования рейтинга</li>
              <li>временно ограничивать влияние отдельных отзывов на рейтинг</li>
            </ul>
            <p>Это может происходить в целях предотвращения манипуляций, борьбы с накруткой и защиты пользователей сервиса.</p>
            <p>Rateus не обязан раскрывать алгоритмы формирования рейтинга.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6. Ответственность специалистов</h2>
            <p>Специалист, размещающий профиль на платформе Rateus, подтверждает, что:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>оказывает услуги самостоятельно</li>
              <li>несет полную ответственность за качество услуг</li>
              <li>самостоятельно принимает оплату от клиентов</li>
              <li>самостоятельно выполняет налоговые обязательства</li>
            </ul>
            <p>Rateus не несет ответственности за качество услуг, действия специалистов и последствия взаимодействия между пользователями.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7. Пользовательский контент</h2>
            <p>Пользователи несут ответственность за размещаемый ими контент, включая отзывы.</p>
            <p>Пользователь гарантирует, что размещаемая информация не нарушает законодательство, не содержит клеветы и не нарушает права третьих лиц.</p>
            <p>Размещая контент на платформе Rateus, пользователь предоставляет Rateus неисключительную лицензию на использование, хранение и отображение такого контента в рамках функционирования сервиса.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">8. Ограничение ответственности</h2>
            <p>Сервис Rateus предоставляется по принципу «как есть».</p>
            <p>Rateus не гарантирует непрерывную работу сервиса, отсутствие технических ошибок и соответствие сервиса ожиданиям пользователя.</p>
            <p>Rateus не несет ответственности за любые убытки, возникшие в результате использования сервиса.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9. Ограничение доступа</h2>
            <p>Rateus вправе ограничить или прекратить доступ пользователя к сервису в случае нарушения условий соглашения, попыток манипуляции рейтингом, публикации ложной информации и использования сервиса в противоправных целях.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10. Изменение условий</h2>
            <p>Rateus вправе изменять условия настоящего соглашения.</p>
            <p>Новая редакция вступает в силу с момента её публикации на сайте.</p>
            <p>Продолжение использования сервиса означает согласие пользователя с обновленными условиями.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">11. Применимое право</h2>
            <p>К настоящему соглашению применяется законодательство Республики Казахстан.</p>
            <p>Все споры подлежат разрешению в соответствии с законодательством Республики Казахстан.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">12. Контакты</h2>
            <p>Email: <a href="mailto:support@rateus.kz" className="text-primary underline">support@rateus.kz</a></p>
            <p>Сайт: <a href="https://rateus.kz" className="text-primary underline">rateus.kz</a></p>
          </section>
        </div>
      </div>
    </div>
  );
}
