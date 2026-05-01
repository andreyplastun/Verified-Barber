import { useState } from 'react';
import { Link } from 'wouter';
import { signUp } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface SignUpFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
  onClose?: () => void;
}

export function SignUpForm({ onSuccess, onSwitchToLogin }: SignUpFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!consent) {
      setError('Необходимо принять условия соглашений');
      return;
    }

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
      try {
        await fetch('/api/legal-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: null, documents: ['terms', 'privacy'] }),
        });
      } catch {}
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

      <div className="flex items-start space-x-3 rounded-md border p-4">
        <Checkbox
          id="consent-checkbox"
          checked={consent}
          onCheckedChange={(checked) => setConsent(checked === true)}
          data-testid="checkbox-signup-consent"
        />
        <label htmlFor="consent-checkbox" className="text-sm leading-relaxed cursor-pointer">
          Я принимаю условия{" "}
          <Link href="/terms" className="text-primary underline">Пользовательского соглашения</Link>
          {" "}и{" "}
          <Link href="/privacy" className="text-primary underline">Политику конфиденциальности</Link>
        </label>
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="text-signup-error">{error}</p>
      )}

      <Button 
        type="submit" 
        className="w-full" 
        disabled={loading || !consent}
        data-testid="button-signup-submit"
      >
        {loading ? 'Регистрация...' : 'Зарегистрироваться'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Уже есть аккаунт?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-foreground underline font-medium"
          data-testid="link-switch-to-login"
        >
          Войти
        </button>
      </p>
    </form>
  );
}
