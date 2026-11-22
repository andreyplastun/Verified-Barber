import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeClaimPhone, CLAIM_PHONE_ERROR } from "@shared/claim-phone";
import { getAnonId } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/queryClient";

async function post(path: string, body: object) {
  const r = await fetch("/api/master-access/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.message || "Не удалось выполнить запрос");
  return data;
}
export function MasterPhoneForm({ specialistId }: { specialistId?: number }) {
  const purpose = specialistId ? "claim" : "login";
  const [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [wait, setWait] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  async function send() {
    const n = normalizeClaimPhone(phone);
    if (!n) {
      setError(CLAIM_PHONE_ERROR);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await post("request", {
        purpose,
        phone: n,
        specialistId,
        anonId: getAnonId(),
      });
      setChallenge(d.challengeId);
      setWait(d.retryAfter);
      setCode("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      const d = await post("verify", { purpose, challengeId: challenge, code });
      if (d.session) {
        const session = await supabase.auth.setSession(d.session);
        if (session.error) throw session.error;
        window.location.replace("/specialist-dashboard");
        return;
      }
      setDone(d.message);
      if (specialistId)
        await queryClient.invalidateQueries({
          queryKey: ["/api/specialists", specialistId, "claim-status"],
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <p role="status" className="py-4">
        {done}
      </p>
    );
  return (
    <form
      data-clarity-mask="true"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void (challenge ? verify() : send());
      }}
    >
      <label className="block text-sm font-medium">
        Номер WhatsApp
        <Input
          type="tel"
          autoComplete="tel"
          required
          value={phone}
          disabled={!!challenge || busy}
          placeholder="+7 701 123 45 67"
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      {challenge && (
        <>
          <p className="text-sm text-muted-foreground">
            {specialistId
              ? "Введите код из WhatsApp."
              : "Если по этому номеру есть доступ, код придёт в WhatsApp."}{" "}
            Код действует 10 минут.
          </p>
          <label className="block text-sm font-medium">
            Код из WhatsApp
            <Input
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={busy || (challenge ? code.length !== 6 : !phone.trim())}
      >
        {busy
          ? "Подождите…"
          : !challenge
            ? "Получить код в WhatsApp"
            : specialistId
              ? "Подтвердить и отправить заявку"
              : "Войти по коду"}
      </Button>
      {challenge && (
        <div className="flex justify-between gap-3 text-sm">
          <button type="button" disabled={busy || wait > 0} onClick={send}>
            {wait ? `Повторить через ${wait} с` : "Отправить ещё раз"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setChallenge("");
              setError("");
              setCode("");
            }}
          >
            Изменить номер
          </button>
        </div>
      )}
    </form>
  );
}
