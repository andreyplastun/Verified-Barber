import { useState } from 'react';
import { signUp } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SignUpFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

export function SignUpForm({ onSuccess, onSwitchToLogin }: SignUpFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }

    setLoading(true);

    try {
      await signUp(email, password);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ваш@email.com"
          required
          data-testid="input-signup-email"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password">Пароль</Label>
        <Input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль (мин. 6 символов)"
          required
          data-testid="input-signup-password"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-password">Подтвердите пароль</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Повторите пароль"
          required
          data-testid="input-signup-confirm-password"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="text-signup-error">{error}</p>
      )}

      <Button 
        type="submit" 
        className="w-full" 
        disabled={loading}
        data-testid="button-signup-submit"
      >
        {loading ? 'Регистрация...' : 'Зарегистрироваться'}
      </Button>

      <p className="text-center text-sm text-[#6B7280]">
        Уже есть аккаунт?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-[#1F2933] underline font-medium"
          data-testid="link-switch-to-login"
        >
          Войти
        </button>
      </p>
    </form>
  );
}
