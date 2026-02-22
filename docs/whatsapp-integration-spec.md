# Rateus — Спецификация WhatsApp-интеграции через AssistBot

## 1. Backend / архитектура

- **Стек**: Node.js + Express + TypeScript
- **Хостинг**: Replit (single process: Express backend + Vite frontend на порту 5000)
- **База данных**: PostgreSQL (Neon-backed), ORM — Drizzle
- **Очередь/Scheduler**: `setInterval` каждые 5 минут внутри Express-процесса. Отдельного worker/CRON нет — фоновые задачи (not_completed, payment_timeout, wa_queue) выполняются в том же процессе.

---

## 2. Модель визита (bookings)

Таблица `bookings`, ключевые поля:

| Поле | Тип | Описание |
|---|---|---|
| `id` | serial PK | |
| `specialistId` | integer | ID специалиста |
| `clientId` | uuid (nullable) | ID пользователя (null для phone-only) |
| `customerName` | text | Имя клиента |
| `customerPhone` | text (nullable) | Телефон (raw) |
| `normalizedPhone` | text (nullable) | Нормализованный телефон |
| `appointmentTime` | timestamp | Время визита |
| `status` | enum | `scheduled` → `ready_to_complete` → `payment_pending` / `completed` / `cancelled` |
| `hasReview` | boolean | Оставлен ли отзыв |
| `paymentStatus` | enum | `unpaid` / `paid` / `refunded` |
| `visitTrustWeight` | real | Вес визита для рейтинга |
| `completionType` | enum | `with_payment` / `with_review` |
| `altegioAppointmentId` | integer | ID записи в Altegio |

**Что переводит визит в completed:**
- Специалист нажимает "Отправить отзыв" → `ready_to_complete` → `completed` (completionType=`with_review`, visitTrustWeight=1.0)
- Altegio webhook `record.completed` / `appointment.completed`
- Altegio sync: обнаружен completed статус в Altegio
- `payment_pending` автоматически → `completed` через 24ч (background job)

---

## 3. Триггер отправки PRIMARY сообщения

Вызывается функция `tryCreateMagicLinkForCompletedVisit(bookingId, source)` в файле `server/routes.ts` (строка ~1594).

**Точное условие (if):**

```
if (booking.status !== 'completed') → skip
if (paymentStatus === 'refunded') → skip
if (нет clientId И нет phone) → skip
if (есть clientId → проверка eligibility: <60 дней между отзывами, ignored ≥2 → skip)
if (уже есть magic_link для booking) → skip
→ создаётся magic link
→ если есть customerPhone → enqueueReviewMessage(type="primary")
```

**Событие**: `completed` (НЕ paid). Оплата не требуется для отправки.

**Где вызывается:**
- `POST /api/specialist/bookings/:id/complete-with-review` — специалист завершает визит
- `processPaymentSuccess()` — после подтверждения оплаты
- Altegio webhook `record.completed` / `record.attendance`
- `syncUpcomingAppointments()` — при startup и ручном синке

---

## 4. Magic link

- **Генерация**: функция `tryCreateMagicLinkForCompletedVisit()` в `server/routes.ts`
- **Хранение**: таблица `magic_links`
  - `token` — уникальный случайный токен
  - `bookingId` — привязка к визиту
  - `specialistId` — привязка к специалисту
  - `userId` — nullable (null для phone-only клиентов)
  - `customerPhone` — nullable (заполняется для phone-only)
  - `expiresAt` — срок действия 48ч
- **URL формат**: `/r/{token}` (прод: `https://www.rateus.kz/r/{token}`)
- **Endpoint открытия**: `GET /api/magic-link/:token` — возвращает данные визита, specialistId, isPhoneOnly
- **Флаг `review_requested`**: отдельного флага нет. Наличие записи в `magic_links` для данного bookingId + поле `reviewEligibility` на booking.

---

## 5. Данные для сообщения

| Данные | Источник |
|---|---|
| `clientName` | `booking.customerName` (из таблицы bookings) |
| `specialistName` | `specialist.name` (запрос `storage.getSpecialist(booking.specialistId)`) |
| `reviewLink` | Генерируется: `{baseUrl}/r/{magicLink.token}` |
| `phone` | `booking.normalizedPhone` или `booking.customerPhone` (приоритет normalized) |

**Формат телефона:**
- `customerPhone` — raw (как пришёл из Altegio)
- `normalizedPhone` — нормализованный через `normalizePhone()` из `server/client-identity.ts`
- При отправке в AssistBot — очищается до цифр: `phone.replace(/\D/g, "")`

---

## 6. Reminder (2-е сообщение)

- **Условие**: PRIMARY успешно отправлен (`status=sent`)
- **Интервал**: 24 часа + случайный jitter 0–60 минут
- **Определение "отзыв оставлен"**: при обработке очереди проверяется `booking.hasReview === true` → если да, reminder помечается `skipped` с reason=`review_already_submitted`
- **Максимум**: 1 PRIMARY + 1 REMINDER на визит (дубликаты блокируются через `getWaMessageByBookingAndType`)

---

## 7. Ограничения сообщений

- **Максимум на 1 визит**: 2 сообщения (1 primary + 1 reminder)
- **Блокировка если есть отзыв**: да — `booking.hasReview === true` → skip с reason `review_already_submitted`
- **Блокировка если нет телефона**: да — `tryCreateMagicLinkForCompletedVisit` возвращает false если нет clientId И нет phone
- **Блокировка если booking cancelled**: да → skip с reason `booking_cancelled`
- **Блокировка если opt-out**: да — проверка таблицы `wa_opt_outs` по нормализованному телефону

---

## 8. Throttling / прогрев

Расписание прогрева (от `WA_WARMUP_START_DATE`):

| Дни от старта | Лимит/день |
|---|---|
| 1–3 | min(2, dailyLimit) |
| 4–7 | min(5, dailyLimit) |
| 8–14 | min(10, dailyLimit) |
| 15+ | min(20, dailyLimit) |
| Нет даты прогрева | dailyLimit (по умолчанию 20) |

- **Anti-spam интервалы**: случайная задержка 3–15 минут между сообщениями в одном batch
- **Batch size**: до 5 сообщений за один цикл обработки (каждые 5 минут)

---

## 9. Retry / ошибки

- **Retry**: да
- **Максимум попыток**: 2 (`maxAttempts=2` в таблице `wa_messages`)
- **Задержка между попытками**: случайная 10–30 минут
- **После исчерпания попыток**: статус `failed`, ошибка сохраняется в поле `lastError`

---

## 10. Управление отправкой

- **Toggle enable/disable**: `WA_SENDING_ENABLED` в таблице `app_config`, переключается из Admin UI
- **Emergency stop**: `WA_SENDING_ENABLED=false` — немедленно останавливает обработку очереди
- **Дневной лимит**: `WA_DAILY_LIMIT` в `app_config` (по умолчанию 20), настраивается из Admin UI
- **Admin UI**: вкладка "WhatsApp" в AdminDashboard — toggle, дата прогрева, лимит, счётчик "отправлено сегодня", лог сообщений

---

## 11. AssistBot интеграция

Реализация в `server/whatsapp.ts`, функция `sendViaAssistBot`.

- **Endpoint**: `POST https://lk.assistbot.ru/api/web/index.php/send-message/`
- **Авторизация**: `Authorization: Bearer {ASSISTBOT_TOKEN}`
- **HTTP метод**: `POST`
- **Content-Type**: `application/json`
- **Request body**:

```json
{
  "destination_params": [
    {
      "id": "rateus_visit_123",
      "phone": "77001234567"
    }
  ],
  "text": "Текст сообщения",
  "type": "whatsapp"
}
```

- `id` формируется как `rateus_visit_{bookingId}`
- `phone` — только цифры (очищен от +, пробелов, скобок)

- **Env vars**: `ASSISTBOT_TOKEN` (обязательно)
- **Сохранение ответа**: `assistbot_message_id` из ответа API сохраняется в таблицу `wa_messages`
- **Защита от дублей**: если `assistbot_message_id` уже заполнен для сообщения — повторная отправка блокируется
- **Реализованные методы**: только отправка текстового сообщения. Webhook / status callback — не реализованы.

---

## Таблицы БД для WhatsApp

### wa_messages

| Поле | Тип | Описание |
|---|---|---|
| `id` | serial PK | |
| `bookingId` | integer | ID визита |
| `specialistId` | integer | ID специалиста |
| `customerPhone` | text | Телефон клиента (только цифры) |
| `customerName` | text | Имя клиента |
| `specialistName` | text | Имя специалиста |
| `reviewLink` | text | Ссылка на отзыв |
| `messageType` | enum | `primary` / `reminder` |
| `status` | enum | `queued` / `sending` / `sent` / `failed` / `skipped` |
| `templateIndex` | integer | Индекс шаблона (0–4) |
| `messageText` | text | Финальный текст сообщения |
| `attempts` | integer | Кол-во попыток (default 0) |
| `maxAttempts` | integer | Макс попыток (default 2) |
| `scheduledAt` | timestamp | Запланированное время отправки |
| `sentAt` | timestamp (nullable) | Фактическое время отправки |
| `lastError` | text (nullable) | Последняя ошибка |
| `skipReason` | text (nullable) | Причина пропуска |
| `assistbotMessageId` | text (nullable) | ID сообщения от AssistBot (защита от дублей) |
| `createdAt` | timestamp | |

### wa_opt_outs

| Поле | Тип | Описание |
|---|---|---|
| `id` | serial PK | |
| `phone` | text (unique) | Телефон (только цифры) |
| `createdAt` | timestamp | |

### app_config (настройки WA)

| Ключ | Описание |
|---|---|
| `WA_SENDING_ENABLED` | `"true"` / `"false"` — вкл/выкл отправку |
| `WA_WARMUP_START_DATE` | `"YYYY-MM-DD"` — дата начала прогрева |
| `WA_DAILY_LIMIT` | число — макс сообщений в день (default 20) |

---

## Шаблоны сообщений

### PRIMARY (5 вариантов)

1. `{clientName}, спасибо за визит к {specialistName}.\nОставьте отзыв:\n{reviewLink}`
2. `{clientName}, благодарим за визит к {specialistName} ✨\nБудем признательны за отзыв:\n{reviewLink}`
3. `{clientName}, как прошёл визит к {specialistName}?\nОставить отзыв:\n{reviewLink}`
4. `{clientName}, спасибо, что выбрали {specialistName}.\nПоделитесь впечатлением:\n{reviewLink}`
5. `{clientName}, визит к {specialistName} завершён.\nОцените специалиста:\n{reviewLink}`

### REMINDER (5 вариантов)

1. `{clientName}, отзыв о визите к {specialistName} ещё можно оставить:\n{reviewLink}`
2. `{clientName}, напоминание об отзыве для {specialistName}.\nЭто займёт несколько секунд:\n{reviewLink}`
3. `{clientName}, если удобно — оставьте отзыв о визите к {specialistName}:\n{reviewLink}`
4. `{clientName}, оценка визита к {specialistName} всё ещё доступна:\n{reviewLink}`
5. `{clientName}, последняя возможность оценить визит к {specialistName}:\n{reviewLink}`

Выбор шаблона — случайный, без повтора последнего использованного.
