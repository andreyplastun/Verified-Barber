import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, MapPin } from "lucide-react";
import { InteractiveStarRating } from "@/components/ui/animations";
import { submitManualVisitReview } from "@/lib/manualVisitReview";
import { getFreshBrowserLocation, type BrowserLocation, type GeoStatus } from "@/pages/manualPresenceLocation";

type Props = {
  token: string;
  geoAllowed?: boolean;
  expectedEnd?: string;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onSuccess: () => void;
  onConfirmed: () => void;
};

type LocationAttempt = { id: string; expiresAt: number; receivedAt: number };
const expiredLocationMessage = "Время проверки местоположения истекло. Отзыв можно отправить без геолокации.";

const geoMessages: Record<GeoStatus, string> = {
  success: "Местоположение получено. Данные будут отправлены вместе с отзывом; результат проверки определит сервис.",
  unsupported: "Браузер не поддерживает геолокацию. Отзыв можно отправить без неё.",
  insecure: "На этом соединении геолокация недоступна. Отзыв можно отправить без неё.",
  denied: "Доступ к местоположению не разрешён. Можно повторить попытку или оставить отзыв без него.",
  timeout: "Браузер не успел определить местоположение. Можно повторить попытку или продолжить без него.",
  unavailable: "Не удалось определить местоположение. Можно повторить попытку или продолжить без него.",
  skipped: "Отзыв будет отправлен без геолокации.",
};

export default function ManualVisitReview({ token, geoAllowed, expectedEnd, disabled, onBusyChange, onSuccess, onConfirmed }: Props) {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState("");
  const [showName, setShowName] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  const [attempt, setAttempt] = useState<LocationAttempt>();
  const [geoError, setGeoError] = useState("");
  const [geoPending, setGeoPending] = useState(false);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("skipped");
  const [location, setLocation] = useState<BrowserLocation>();
  const requestRef = useRef(0);
  const submitLock = useRef(false);
  const attemptRequest = useRef<Promise<LocationAttempt> | null>(null);
  const savedAttempt = useRef<LocationAttempt>();
  const alive = useRef(true);
  const deadline = expectedEnd ? new Date(expectedEnd).getTime() + 2 * 60 * 60 * 1000 : NaN;
  const canLocate = geoAllowed === true && (!Number.isFinite(deadline) || now < deadline);
  const attemptExpired = Boolean(attempt && now >= attempt.expiresAt);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ++requestRef.current; };
  }, []);

  useEffect(() => {
    if (!geoAllowed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [geoAllowed, deadline]);

  const getAttempt = (): Promise<LocationAttempt> => {
    if (savedAttempt.current) return Promise.resolve(savedAttempt.current);
    if (attemptRequest.current) return attemptRequest.current;
    const preparation = (async (): Promise<LocationAttempt> => {
        const response = await fetch(`/api/visit-confirmations/${encodeURIComponent(token)}/attempt`, {
          method: "POST",
          credentials: "include",
        });
        const body = await response.json().catch(() => ({}));
        const receivedAt = Date.now();
        if (!response.ok || typeof body.id !== "string" || !body.id || typeof body.expiresAt !== "number" || !Number.isFinite(body.expiresAt)) {
          throw new Error(body.message || "Не удалось подготовить геолокацию. Попробуйте снова или отправьте отзыв без неё.");
        }
        const issued = { id: body.id, expiresAt: body.expiresAt, receivedAt };
        // Cache the server's one immutable attempt even if this GPS request was cancelled.
        if (alive.current) savedAttempt.current = issued;
        return issued;
    })();
    attemptRequest.current = preparation;
    void preparation.then(() => { attemptRequest.current = null; }, () => { attemptRequest.current = null; });
    return preparation;
  };

  useEffect(() => {
    if (!canLocate || attemptExpired) {
      ++requestRef.current;
      setGeoPending(false);
      setLocation(undefined);
      setGeoStatus("skipped");
      if (canLocate && attemptExpired) setGeoError(expiredLocationMessage);
    }
  }, [canLocate, attemptExpired]);

  const collectLocation = () => {
    if (!canLocate || busy || disabled || geoPending) return;
    if (Number.isFinite(deadline) && Date.now() >= deadline) {
      setNow(Date.now());
      return;
    }
    if (savedAttempt.current && Date.now() >= savedAttempt.current.expiresAt) {
      setAttempt(savedAttempt.current);
      setNow(Date.now());
      setLocation(undefined);
      setGeoStatus("skipped");
      setGeoError(expiredLocationMessage);
      return;
    }
    const request = ++requestRef.current;
    const current = () => alive.current && request === requestRef.current;
    const windowOpen = () => geoAllowed === true && (!Number.isFinite(deadline) || Date.now() < deadline);
    setGeoPending(true);
    setGeoError("");
    setLocation(undefined);
    setGeoStatus("skipped");
    // Both start in the same click. No network await can consume browser activation.
    const preparation = getAttempt();
    // Keep this call synchronous in the actual button gesture (no preceding await).
    const result = getFreshBrowserLocation(window.isSecureContext, navigator.geolocation);
    void (async () => {
      try {
        const [issued, initialSample] = await Promise.all([preparation, result]);
        if (!current()) return;
        setAttempt(issued);
        if (!windowOpen() || Date.now() >= issued.expiresAt) {
          setGeoError(expiredLocationMessage);
          return;
        }
        let sample = initialSample;
        if (sample.status === "success" && sample.location && sample.location.capturedAt < issued.receivedAt) {
          // Permission was requested by the tap. Obtain a genuinely later sample;
          // never rewrite capturedAt or extend the immutable server attempt.
          sample = await getFreshBrowserLocation(window.isSecureContext, navigator.geolocation);
        }
        if (!current()) return;
        if (!windowOpen() || Date.now() >= issued.expiresAt) {
          setGeoError(expiredLocationMessage);
          return;
        }
        if (sample.location && sample.location.capturedAt < issued.receivedAt) {
          setGeoStatus("unavailable");
          return;
        }
        setGeoStatus(sample.status);
        setLocation(sample.location);
      } catch (cause) {
        if (current()) setGeoError(cause instanceof Error ? cause.message : "Геолокация недоступна. Отзыв можно отправить без неё.");
      } finally {
        if (current()) {
          setGeoPending(false);
          setNow(Date.now());
        }
      }
    })();
  };

  const skipLocation = () => {
    ++requestRef.current;
    setGeoPending(false);
    setLocation(undefined);
    setGeoStatus("skipped");
    setGeoError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLock.current || disabled || geoPending) return;
    if (!rating) { setError("Выберите оценку от 1 до 5."); return; }
    submitLock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    const usableAttempt = geoAllowed === true && (!Number.isFinite(deadline) || Date.now() < deadline) && attempt && Date.now() < attempt.expiresAt ? attempt : undefined;
    if (!usableAttempt) {
      setLocation(undefined);
      setGeoStatus("skipped");
    }
    try {
      await submitManualVisitReview({
        token, rating, comment, showName: isPrivate ? false : showName, isPrivate, onConfirmed,
        ...(usableAttempt ? { attemptId: usableAttempt.id, geoStatus, ...(location ? { location } : {}) } : { geoStatus: "skipped" as const }),
      });
      setSuccess(true);
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Отзыв не сохранился. Попробуйте ещё раз.");
    } finally {
      submitLock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  if (success) return (
    <section className="mt-6 rounded-[24px] border border-border bg-card p-6 text-center" role="status" data-testid="manual-review-success">
      <CheckCircle2 className="mx-auto h-9 w-9 text-primary" />
      <h2 className="mt-4 font-display text-xl font-semibold">Спасибо за отзыв!</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {isPrivate ? "Ваш отзыв сохранён. Он доступен только сервису Rateus." : "Ваш отзыв сохранён. Спасибо, что поделились впечатлениями."}
      </p>
    </section>
  );

  return (
    <form onSubmit={submit} className="mt-6 space-y-5" data-testid="manual-visit-review">
      <fieldset disabled={busy || disabled} className="min-w-0 space-y-5 disabled:opacity-70">
        <div className="rounded-[24px] border border-border bg-card px-4 py-6">
          <p className="mb-4 text-center text-sm font-semibold">Ваша оценка</p>
          <InteractiveStarRating rating={rating} hoveredStar={hoveredStar} onRate={setRating} onHover={setHoveredStar} onLeave={() => setHoveredStar(0)} size={40} />
          <p className="mt-3 text-center text-xs text-muted-foreground" aria-live="polite">{rating ? `Оценка: ${rating} из 5` : "Выберите от 1 до 5"}</p>
        </div>
        <div>
          <label htmlFor="manual-review-comment" className="text-sm font-semibold">Комментарий <span className="font-normal text-muted-foreground">— необязательно</span></label>
          <textarea id="manual-review-comment" value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Что вам запомнилось?" className="mt-2 w-full resize-y rounded-2xl border border-border bg-card p-4 text-sm focus-visible:outline-primary" data-testid="input-manual-review-comment" />
        </div>
        <details className="rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">Имя и видимость отзыва</summary>
          <div className="mt-4 space-y-4 text-sm">
            <label className="flex items-start gap-3"><input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} className="mt-1 accent-primary" /><span>Только сервису Rateus<span className="mt-1 block text-xs leading-5 text-muted-foreground">Отзыв не увидят специалисты и другие клиенты.</span></span></label>
            <label className={`flex items-center gap-3 ${isPrivate ? "opacity-50" : ""}`}><input type="checkbox" checked={showName} disabled={isPrivate} onChange={(event) => setShowName(event.target.checked)} className="accent-primary" />Показывать моё имя</label>
          </div>
        </details>
        {canLocate && (
          <section className="rounded-2xl border border-border bg-card p-4" data-testid="manual-review-location">
            <p className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-primary" />Местоположение — по желанию</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Данные помогут сервису проверить место визита. Разрешение браузера необязательно: отзыв можно отправить без геолокации.</p>
            <button type="button" onClick={collectLocation} disabled={geoPending || attemptExpired} className="mt-3 min-h-11 w-full rounded-xl border border-border px-3 text-sm font-semibold disabled:opacity-50" data-testid="button-manual-review-location">
              {attemptExpired ? "Геолокация больше недоступна" : geoPending ? "Определяем местоположение…" : location ? "Определить ещё раз" : "Разрешить местоположение"}
            </button>
            {(geoPending || location || geoStatus !== "skipped" || geoError) && <button type="button" onClick={skipLocation} className="mt-2 min-h-11 w-full rounded-xl px-3 text-sm text-muted-foreground" data-testid="button-manual-review-skip-location">{geoPending ? "Отменить и продолжить без геолокации" : "Продолжить без геолокации"}</button>}
            {geoError && <p className="mt-3 text-sm text-destructive" role="alert">{geoError}</p>}
            {!geoPending && !geoError && <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">{geoMessages[geoStatus]}</p>}
          </section>
        )}
      </fieldset>
      {error && <div className="flex gap-2 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive" role="alert" data-testid="manual-review-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      <button type="submit" disabled={!rating || busy || disabled || geoPending} className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-transform active:scale-[0.985] disabled:opacity-50" data-testid="button-submit-manual-review">{busy ? "Сохраняем отзыв…" : "Подтвердить визит и оставить отзыв"}</button>
      <p className="text-center text-xs leading-5 text-muted-foreground">Отправляя оценку, вы подтверждаете, что визит состоялся.</p>
    </form>
  );
}
