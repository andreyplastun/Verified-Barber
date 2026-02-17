import { useState } from "react";
import { useLocation, Link } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { getCurrentUserWithRole } from "@/lib/auth";
import { UserPlus } from "lucide-react";
import logoImage from "@assets/410C2451-35F6-4A38-98C8-FF4645466949_1771319885407.png";


export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [isLogin, setIsLogin] = useState(true);

  const handleSuccess = async () => {
    const claimReturn = sessionStorage.getItem("claimReturnUrl");
    if (claimReturn) {
      sessionStorage.removeItem("claimReturnUrl");
      setLocation(claimReturn);
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
              {isLogin ? 'Добро пожаловать' : 'Создание аккаунта'}
            </h1>
            <p className="text-muted-foreground">
              {isLogin ? 'Войдите, чтобы продолжить' : 'Заполните данные для регистрации'}
            </p>
          </div>

          {isLogin ? (
            <LoginForm onSuccess={handleSuccess} onSwitchToSignUp={() => setIsLogin(false)} />
          ) : (
            <SignUpForm onSuccess={handleSuccess} onSwitchToLogin={() => setIsLogin(true)} />
          )}

          <div className="pt-6 border-t">
            <Link 
              href="/specialist-signup" 
              className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-specialist-signup"
            >
              <UserPlus className="h-4 w-4" />
              Добавить себя как специалиста
            </Link>
          </div>

          <div className="pt-4 text-center">
            <Link 
              href="/privacy" 
              className="text-xs text-muted-foreground hover:text-foreground underline"
              data-testid="link-privacy"
            >
              Политика конфиденциальности
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
