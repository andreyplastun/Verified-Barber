import { useState } from 'react';
import { useLocation } from 'wouter';
import { signIn, resetPassword } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Briefcase } from 'lucide-react';

interface LoginFormProps {
  onSuccess: (accessToken?: string) => void | Promise<void>;
  onSwitchToSignUp: () => void;
  onClose?: () => void;
}

export function LoginForm({ onSuccess, onSwitchToSignUp, onClose }: LoginFormProps) {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err: any) {
      setError(err.message || 'Не удалось отправить письмо');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await signIn(email, password);
      await onSuccess(data.session?.access_token);
    } catch (err: any) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  if (resetMode) {
    return (
      <form onSubmit={handleReset} className="space-y-4">
        {resetSent ? (
          <div className="space-y-4">
            <p className="text-sm text-foreground" data-testid="text-reset-sent">
              Письмо отправлено на <span className="font-medium">{email}</span>. Откройте его и перейдите по ссылке, чтобы задать новый пароль.
            </p>
            <p className="text-xs text-muted-foreground">
              Нет письма? Проверьте папку «Спам».
            </p>
            <button
              type="button"
              onClick={() => { setResetMode(false); setResetSent(false); }}
              className="text-sm text-foreground underline font-medium"
              data-testid="link-back-to-login"
            >
              Вернуться ко входу
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Укажите email, с которым регистрировались — пришлём ссылку для смены пароля.
            </p>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ваш@email.com"
                required
                data-testid="input-reset-email"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-reset-error">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-reset-submit">
              {loading ? 'Отправка...' : 'Отправить ссылку'}
            </Button>
            <p className="text-center text-sm">
              <button
                type="button"
                onClick={() => setResetMode(false)}
                className="text-muted-foreground underline"
                data-testid="link-cancel-reset"
              >
                Вернуться ко входу
              </button>
            </p>
          </>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ваш@email.com"
          required
          data-testid="input-login-email"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Пароль</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          required
          data-testid="input-login-password"
        />
        <div className="text-right">
          <button
            type="button"
            onClick={() => { setResetMode(true); setError(''); }}
            className="text-xs text-muted-foreground underline"
            data-testid="link-forgot-password"
          >
            Забыли пароль?
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
      )}

      <Button 
        type="submit" 
        className="w-full" 
        disabled={loading}
        data-testid="button-login-submit"
      >
        {loading ? 'Вход...' : 'Войти'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Нет аккаунта?{' '}
        <button
          type="button"
          onClick={onSwitchToSignUp}
          className="text-foreground underline font-medium"
          data-testid="link-switch-to-signup"
        >
          Зарегистрироваться
        </button>
      </p>

      {onClose && (
        <div className="border-t pt-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              setLocation('/specialist-signup');
            }}
            className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-specialist-signup"
          >
            <Briefcase className="w-4 h-4" />
            <span>Я специалист — стать партнёром</span>
          </button>
        </div>
      )}
    </form>
  );
}
