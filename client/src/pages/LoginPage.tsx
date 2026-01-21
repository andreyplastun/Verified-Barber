import { useState } from "react";
import { useLocation } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { getCurrentUserWithRole } from "@/lib/auth";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [isLogin, setIsLogin] = useState(true);

  const handleSuccess = async () => {
    const user = await getCurrentUserWithRole();
    if (user?.role === 'specialist') {
      setLocation('/specialist-dashboard');
    } else {
      setLocation('/');
    }
  };

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      <div className="h-full w-full flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-sm space-y-6 my-auto">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold" data-testid="text-login-title">
              {isLogin ? 'Добро пожаловать' : 'Регистрация'}
            </h1>
            <p className="text-muted-foreground">
              {isLogin ? 'Войдите, чтобы продолжить' : 'Создайте аккаунт'}
            </p>
          </div>

          {isLogin ? (
            <LoginForm onSuccess={handleSuccess} onSwitchToSignUp={() => setIsLogin(false)} />
          ) : (
            <SignUpForm onSuccess={handleSuccess} onSwitchToLogin={() => setIsLogin(true)} />
          )}
        </div>
      </div>
    </div>
  );
}
