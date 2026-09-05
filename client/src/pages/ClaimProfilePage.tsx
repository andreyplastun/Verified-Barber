import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, Loader2, UserCheck } from "lucide-react";

export default function ClaimProfilePage() {
  const [, params] = useRoute("/claim/:token");
  const token = params?.token || "";
  const { currentUser, user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [bindSuccess, setBindSuccess] = useState(false);
  const [preparingLogin, setPreparingLogin] = useState(false);
  const hasFreshClaimAuth = typeof window !== "undefined"
    && sessionStorage.getItem("claimAuthenticatedToken") === token;

  const continueToClaimLogin = async () => {
    setPreparingLogin(true);
    try {
      if (user) {
        await signOut();
      }
      sessionStorage.setItem("claimReturnUrl", `/claim/${token}`);
      sessionStorage.removeItem("claimAuthenticatedToken");
      window.location.assign("/login");
    } finally {
      setPreparingLogin(false);
    }
  };

  const { data: claimData, isLoading, error } = useQuery<{
    claimId: number;
    specialistId: number;
    specialistName: string;
    specialistImageUrl?: string;
  }>({
    queryKey: ['/api/claim', token],
    queryFn: async () => {
      const res = await fetch(`/api/claim/${token}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const bindMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/claim/${token}/bind`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": currentUser?.id || "",
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      sessionStorage.removeItem("claimAuthenticatedToken");
      setBindSuccess(true);
      window.location.replace("/specialist-dashboard");
    },
  });

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
            <AlertCircle size={48} className="text-red-500" />
            <h2 className="text-lg font-semibold text-foreground">Ссылка недействительна</h2>
            <p className="text-sm text-muted-foreground">
              {(error as Error).message || "Ссылка истекла или уже была использована"}
            </p>
            <Button variant="outline" onClick={() => navigate("/")} data-testid="button-claim-go-home">
              На главную
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (bindSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
            <CheckCircle2 size={48} className="text-green-500" />
            <h2 className="text-lg font-semibold text-foreground">Профиль привязан</h2>
            <p className="text-sm text-muted-foreground">
              Вы теперь управляете профилем «{claimData?.specialistName}».
              Перейдите в личный кабинет для настройки.
            </p>
            <Button onClick={() => navigate("/specialist-dashboard")} data-testid="button-go-to-dashboard">
              Перейти в кабинет
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!claimData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="max-w-sm w-full">
        <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
          {claimData.specialistImageUrl && (
            <img
              src={claimData.specialistImageUrl}
              alt={claimData.specialistName}
              className="w-20 h-20 rounded-full object-cover border-2 border-muted"
            />
          )}
          <UserCheck size={32} className="text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Привязка профиля</h2>
          <p className="text-sm text-muted-foreground">
            Вы хотите привязать профиль «{claimData.specialistName}» к своему аккаунту?
          </p>

          {!user || !hasFreshClaimAuth ? (
            <div className="space-y-3 w-full">
              <p className="text-sm text-muted-foreground">
                {user
                  ? `Сейчас открыт аккаунт ${user.email}. Чтобы профиль не привязался к чужому аккаунту, войдите заново как его владелец или создайте для него отдельные данные входа.`
                  : "Войдите или создайте данные для входа. Имя и телефон повторно вводить не потребуется — они уже сохранены в этом профиле."}
              </p>
              <Button
                className="w-full"
                onClick={continueToClaimLogin}
                disabled={preparingLogin}
                data-testid="button-claim-login"
              >
                {preparingLogin ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Подготовка...</>
                ) : user ? (
                  "Войти как владелец профиля"
                ) : (
                  "Войти / Зарегистрироваться"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3 w-full">
              <p className="text-xs text-muted-foreground">
                Аккаунт: {user.email}
              </p>
              {bindMutation.isError && (
                <p className="text-sm text-red-500" data-testid="text-bind-error">
                  {(bindMutation.error as Error).message}
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => bindMutation.mutate()}
                disabled={bindMutation.isPending}
                data-testid="button-bind-profile"
              >
                {bindMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Привязка...</>
                ) : (
                  "Привязать профиль"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
