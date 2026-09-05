import { useState } from "react";
import { useLocation, Link } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { LegalFooter } from "@/components/LegalFooter";
import { ClientBenefits } from "@/components/ClientBenefits";
import { getCurrentUserWithRole } from "@/lib/auth";
import { UserPlus, User, Briefcase, ChevronRight, ArrowLeft } from "lucide-react";
import logoImage from "@assets/410C2451-35F6-4A38-98C8-FF4645466949_1771319885407.png";

type Mode = "login" | "choose-role" | "client-signup";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<Mode>("login");
  const claimTokenFromUrl = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("claim")
    : null;
  const isClaimFlow = typeof window !== "undefined"
    && Boolean(claimTokenFromUrl || sessionStorage.getItem("claimReturnUrl"));

  const handleSuccess = async () => {
    const claimReturn = claimTokenFromUrl
      ? `/claim/${claimTokenFromUrl}`
      : sessionStorage.getItem("claimReturnUrl");
    if (claimReturn) {
      const claimToken = claimReturn.match(/^\/claim\/([^/]+)$/)?.[1];
      if (claimToken) {
        sessionStorage.setItem("claimAuthenticatedToken", claimToken);
      }
      sessionStorage.removeItem("claimReturnUrl");
      window.location.replace(claimReturn);
      return;
    }
    const user = await getCurrentUserWithRole();
    if (user?.role === 'specialist') {
      setLocation('/specialist-dashboard');
    } else {
      setLocation('/');
    }
  };

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      <div className="h-full w-full flex flex-col items-center justify-center p-4 overflow-y-auto">
        {/* Logo */}
        <div className="mb-12">
          <img src={logoImage} alt="Logo" className="w-28 h-28" data-testid="img-logo" />
        </div>

        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold" data-testid="text-login-title">
              {mode === "login" && "Добро пожаловать"}
              {mode === "choose-role" && "Кто вы?"}
              {mode === "client-signup" && (isClaimFlow ? "Создание входа" : "Создание аккаунта")}
            </h1>
            <p className="text-muted-foreground">
              {mode === "login" && "Войдите, чтобы продолжить"}
              {mode === "choose-role" && "Выберите, как хотите зарегистрироваться"}
              {mode === "client-signup" && (
                isClaimFlow
                  ? "Имя и телефон уже сохранены в профиле"
                  : "Регистрация клиента"
              )}
            </p>
          </div>

          {mode === "login" && (
            <>
              <LoginForm
                onSuccess={handleSuccess}
                onSwitchToSignUp={() => setMode(isClaimFlow ? "client-signup" : "choose-role")}
              />

              {!isClaimFlow && <div className="pt-6 border-t space-y-3">
                <p className="text-center text-xs text-muted-foreground uppercase tracking-wide">
                  Вы специалист?
                </p>
                <Link
                  href="/specialist-signup"
                  className="flex items-center justify-center gap-2 w-full rounded-md border border-primary/40 bg-primary/5 px-4 py-3 text-sm font-medium text-foreground hover:bg-primary/10 transition-colors"
                  data-testid="link-specialist-signup"
                >
                  <UserPlus className="h-4 w-4" />
                  Зарегистрироваться как специалист
                </Link>
              </div>}
            </>
          )}

          {mode === "choose-role" && (
            <div className="space-y-3">
              <Link
                href="/specialist-signup"
                className="flex items-center gap-4 w-full rounded-lg border-2 border-primary/40 bg-primary/5 p-4 text-left hover:bg-primary/10 transition-colors"
                data-testid="button-role-specialist"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">Я специалист</p>
                  <p className="text-sm text-muted-foreground">Оказываю услуги, хочу профиль и отзывы</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
              </Link>

              <button
                type="button"
                onClick={() => setMode("client-signup")}
                className="flex items-center gap-4 w-full rounded-lg border p-4 text-left hover-elevate active-elevate-2 transition-colors"
                data-testid="button-role-client"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-5 w-5 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">Я клиент</p>
                  <p className="text-sm text-muted-foreground">Ищу специалистов и записываюсь к ним</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setMode("login")}
                className="flex items-center justify-center gap-1 w-full text-sm text-muted-foreground pt-2"
                data-testid="link-back-to-login"
              >
                <ArrowLeft className="h-4 w-4" />
                Назад ко входу
              </button>
            </div>
          )}

          {mode === "client-signup" && (
            <>
              {!isClaimFlow && <ClientBenefits />}
              <SignUpForm onSuccess={handleSuccess} onSwitchToLogin={() => setMode("login")} />
              <button
                type="button"
                onClick={() => setMode(isClaimFlow ? "login" : "choose-role")}
                className="flex items-center justify-center gap-1 w-full text-sm text-muted-foreground"
                data-testid="link-back-to-role-choice"
              >
                <ArrowLeft className="h-4 w-4" />
                {isClaimFlow ? "Назад ко входу" : "Я не клиент, я специалист"}
              </button>
            </>
          )}

        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
