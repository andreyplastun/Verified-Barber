import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function AssistBotConnection() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
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
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <h3 className="font-medium">Подключение входящих AssistBot</h3>
      <p className="text-xs text-muted-foreground">
        Вставьте защищённый адрес в AssistBot → Ретрансляция сообщений → URL.
        Выберите «Все сообщения с полным телом хука» и сохраните.
        Этот шаг подключает входящие события, но не включает запросы через 24 часа.
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
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}