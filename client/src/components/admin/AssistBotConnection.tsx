import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Specialist } from "@shared/schema";

type EnquiryTest = {
  id: number;
  status: string;
  issuedAt: string;
  incomingReceivedAt: string | null;
  dueAt: string | null;
  incomingBound: boolean;
  recipientPhone: string;
  delaySeconds: number;
  specialistId: number;
  specialistName: string;
  queueStatus: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  skipReason: string | null;
  deliveryStatus: string | null;
  confirmationUrl: string | null;
};

export function AssistBotConnection({ specialists }: { specialists: Specialist[] }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [specialistId, setSpecialistId] = useState("");
  const [connectedPhone, setConnectedPhone] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [tests, setTests] = useState<EnquiryTest[]>([]);
  const [issued, setIssued] = useState<{ code: string; text: string; whatsappUrl: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);

  async function loadTests() {
    const response = await fetch("/api/admin/whatsapp/enquiry-tests", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Не удалось загрузить тесты");
    setTests(data.tests || []);
    setConnectedPhone((current) => current || data.connectedPhone || "");
    setInstanceId((current) => current || data.instanceId || "");
  }

  useEffect(() => {
    loadTests().catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить тесты"));
    const timer = window.setInterval(() => {
      loadTests().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/assistbot-webhook-url", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не удалось получить адрес");
      setUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось получить адрес");
    } finally { setBusy(false); }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      field.current?.focus();
      field.current?.select();
      setError("Выделенный адрес скопируйте вручную.");
    }
  }
  async function issueTest() {
    setBusy(true);
    setError("");
    setIssued(null);
    try {
      const response = await fetch("/api/admin/whatsapp/enquiry-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          specialistId: Number(specialistId),
          connectedRecipientPhone: connectedPhone,
          instanceId,
          connectedConfirmed: confirmed,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не удалось выпустить код");
      setIssued(data);
      await loadTests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выпустить код");
    } finally {
      setBusy(false);
    }
  }

  const formatTime = (value: string | null) =>
    value ? new Date(value).toLocaleString("ru-RU") : "—";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3 space-y-3">
        <h3 className="font-medium">Подключение входящих AssistBot</h3>
        <p className="text-xs text-muted-foreground">
          Вставьте защищённый адрес в AssistBot → Ретрансляция сообщений → URL.
          Выберите «Все сообщения с полным телом хука» и сохраните.
        </p>
        {!url ? (
          <Button type="button" variant="outline" disabled={busy} onClick={prepare}>
            {busy ? "Загрузка…" : "Получить защищённый адрес"}
          </Button>
        ) : (
          <>
            <input ref={field} readOnly value={url} aria-label="Защищённый адрес AssistBot"
              className="w-full rounded border p-2 text-xs" autoComplete="off"
              onFocus={e => e.target.select()} />
            <Button type="button" onClick={copy}>{copied ? "Скопировано" : "Скопировать адрес"}</Button>
            <p className="text-xs text-muted-foreground">Адрес секретный. Не публикуйте его и не присылайте в чат.</p>
          </>
        )}
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div>
          <h3 className="font-medium">Короткий тест запроса (только администратор)</h3>
          <p className="text-xs text-muted-foreground">
            Только выпущенный здесь код получает задержку 2 минуты после фактического входящего сообщения.
            Обычные запросы остаются на 24 часа. «Срок наступил» не означает «отправлено»:
            сообщение после срока ждёт общую очередь, дневной лимит и безопасный интервал WhatsApp.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="test-specialist">Тестовый специалист</Label>
            <select
              id="test-specialist"
              value={specialistId}
              onChange={(e) => setSpecialistId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              data-testid="select-wa-enquiry-test-specialist"
            >
              <option value="">Выберите специалиста</option>
              {specialists.filter((s) => s.status === "active").map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="connected-phone">Подключённый номер сервиса</Label>
            <Input
              id="connected-phone"
              value={connectedPhone}
              onChange={(e) => { setConnectedPhone(e.target.value); setConfirmed(false); }}
              placeholder="+7 777 000 00 00"
              data-testid="input-wa-enquiry-connected-phone"
            />
            <p className="text-xs text-muted-foreground">
              Не номер произвольного специалиста, а получатель, реально подключённый к этому AssistBot.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="assistbot-instance">Instance ID (если AssistBot его присылает)</Label>
            <Input id="assistbot-instance" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Подтверждаю, что этот получатель подключён к AssistBot
          </label>
        </div>
        <Button
          type="button"
          onClick={issueTest}
          disabled={busy || !specialistId || !connectedPhone || !confirmed}
          data-testid="button-issue-wa-enquiry-test"
        >
          {busy ? "Выпуск…" : "Выпустить тестовый код"}
        </Button>
        {issued && (
          <div className="rounded border border-green-600/40 bg-green-50 p-3 space-y-2 text-sm">
            <p><strong>Код выпущен:</strong> {issued.code}</p>
            <p className="whitespace-pre-wrap text-xs">{issued.text}</p>
            <Button type="button" size="sm" onClick={() => window.open(issued.whatsappUrl, "_blank", "noopener,noreferrer")}>
              Открыть подключённый WhatsApp
            </Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Статусы последних тестов</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => loadTests().catch((e) => setError(e.message))}>
            Обновить
          </Button>
        </div>
        {tests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Тестовые коды ещё не выпускались.</p>
        ) : tests.map((test) => (
          <div key={test.id} className="rounded border p-3 text-sm space-y-1" data-testid={`wa-enquiry-test-${test.id}`}>
            <p className="font-medium">#{test.id} · {test.specialistName} · {test.recipientPhone}</p>
            <p>Код выпущен: {formatTime(test.issuedAt)}</p>
            <p>Входящее получено и привязано: {test.incomingBound ? formatTime(test.incomingReceivedAt) : "ещё нет"}</p>
            <p>Срок отправки: {formatTime(test.dueAt)}</p>
            <p>
              Очередь/отправка: {test.sentAt
                ? `отправлено ${formatTime(test.sentAt)}`
                : test.queueStatus === "sending"
                  ? "отправляется"
                  : test.queueStatus === "queued"
                    ? (test.dueAt && new Date(test.dueAt) <= new Date() ? "срок наступил, ждёт общей очереди" : "поставлено в очередь, срок ещё не наступил")
                    : test.queueStatus === "failed"
                      ? "ошибка отправки"
                      : test.queueStatus || "ожидается входящее"}
            </p>
            {test.sentAt && test.deliveryStatus && (
              <p>Статус доставки: {test.deliveryStatus}</p>
            )}
            {(test.lastError || test.skipReason) && (
              <p className="text-destructive">Причина: {test.lastError || test.skipReason}</p>
            )}
            {test.confirmationUrl && (
              <a
                href={test.confirmationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-primary underline"
                data-testid={`link-wa-enquiry-confirmation-${test.id}`}
              >
                Открыть подтверждение без ожидания отправки
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}