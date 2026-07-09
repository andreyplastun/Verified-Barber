import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { updatePassword, getCurrentUserWithRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, KeyRound } from "lucide-react";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Three ways to land here:
    // 1. Recovery link from email: URL carries a token supabase-js exchanges
    //    for a session (detectSessionInUrl). Wait generously for that.
    // 2. Expired/used link: Supabase redirects with error params -> invalid.
    // 3. Logged-in user changing password voluntarily: session already exists.
    const urlParams = window.location.hash + window.location.search;
    const urlHasError = /error=|error_code=/.test(urlParams);
    const urlHasToken = /access_token=|type=recovery|code=/.test(urlParams);

    if (urlHasError) {
      setHasSession(false);
      return;
    }

    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted && data.session) setHasSession(true);
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (session) setHasSession(true);
    });
    // With a token in the URL, give the exchange up to 10s before declaring
    // the link dead; without one, a short wait is enough to detect a session.
    const timer = setTimeout(() => {
      if (mounted) setHasSession((prev) => (prev === null ? false : prev));
    }, urlHasToken ? 10000 : 3000);
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err: any) {
      setError(err.message || "Не удалось сменить пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle className="w-14 h-14 text-green-500 mx-auto" />
            <h1 className="text-xl font-bold" data-testid="text-password-changed">
              Пароль изменён
            </h1>
            <p className="text-sm text-muted-foreground">
              Теперь используйте новый пароль для входа.
            </p>
            <Button
              className="w-full"
              onClick={async () => {
                const user = await getCurrentUserWithRole();
                setLocation(user?.role === "specialist" ? "/specialist-dashboard" : "/");
              }}
              data-testid="button-go-dashboard"
            >
              Продолжить
            </Button>
          </div>
        ) : hasSession === false ? (
          <div className="text-center space-y-4">
            <h1 className="text-xl font-bold" data-testid="text-link-invalid">
              Ссылка недействительна или устарела
            </h1>
            <p className="text-sm text-muted-foreground">
              Запросите новую ссылку на странице входа: «Забыли пароль?»
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setLocation("/login")}
              data-testid="button-go-login"
            >
              Ко входу
            </Button>
          </div>
        ) : hasSession === null ? (
          <p className="text-center text-sm text-muted-foreground" data-testid="text-checking-link">
            Проверяем ссылку...
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="text-center space-y-2">
              <KeyRound className="w-10 h-10 mx-auto text-muted-foreground" />
              <h1 className="text-xl font-bold" data-testid="text-reset-title">
                Новый пароль
              </h1>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Новый пароль</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Минимум 6 символов"
                required
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Повторите пароль</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Ещё раз"
                required
                data-testid="input-confirm-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-reset-page-error">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-save-password">
              {loading ? "Сохранение..." : "Сохранить пароль"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
