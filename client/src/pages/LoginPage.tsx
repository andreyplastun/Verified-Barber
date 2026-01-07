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
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold" data-testid="text-login-title">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p className="text-muted-foreground">
            {isLogin ? 'Sign in to continue' : 'Sign up to get started'}
          </p>
        </div>

        {isLogin ? (
          <LoginForm onSuccess={handleSuccess} onSwitchToSignUp={() => setIsLogin(false)} />
        ) : (
          <SignUpForm onSuccess={handleSuccess} onSwitchToLogin={() => setIsLogin(true)} />
        )}
      </div>
    </div>
  );
}
