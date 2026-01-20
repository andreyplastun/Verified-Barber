import { useState } from 'react';
import { signIn } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToSignUp: () => void;
}

export function LoginForm({ onSuccess, onSwitchToSignUp }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

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
          className="text-primary underline"
          data-testid="link-switch-to-signup"
        >
          Зарегистрироваться
        </button>
      </p>
    </form>
  );
}
