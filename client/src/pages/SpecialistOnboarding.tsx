import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Banknote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function SpecialistOnboarding() {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  
  const [tipsEnabled, setTipsEnabled] = useState(false);
  const [kaspiPhone, setKaspiPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSaveAndContinue = async () => {
    console.log('[ONBOARDING] Save clicked, currentUser:', currentUser);
    if (!currentUser?.id) {
      console.error('[ONBOARDING] No currentUser.id, aborting');
      return;
    }
    
    setSaving(true);
    try {
      console.log('[ONBOARDING] Calling API for user:', currentUser.id);
      const res = await fetch(`/api/users/${currentUser.id}/complete-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({
          kaspiPhone: kaspiPhone.trim(),
          tipsEnabled: tipsEnabled && kaspiPhone.trim().length > 0,
        }),
      });

      console.log('[ONBOARDING] Response status:', res.status);
      if (!res.ok) {
        const error = await res.json();
        console.error('[ONBOARDING] API error:', error);
        throw new Error(error.message || 'Failed to save');
      }

      const result = await res.json();
      console.log('[ONBOARDING] Success, result:', result);
      toast({
        title: 'Настройки сохранены',
        description: tipsEnabled && kaspiPhone.trim() ? 'Чаевые включены' : 'Вы можете включить чаевые позже в профиле',
      });
      
      // Hard redirect to force full state refresh
      window.location.href = '/specialist-dashboard';
    } catch (err: any) {
      toast({
        title: 'Ошибка',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    if (!currentUser?.id) return;
    
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/complete-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({
          kaspiPhone: null,
          tipsEnabled: false,
          skipped: true,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save');
      }

      // Hard redirect to force full state refresh
      window.location.href = '/specialist-dashboard';
    } catch (err: any) {
      toast({
        title: 'Ошибка',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <Banknote className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-onboarding-title">
            Получайте чаевые от клиентов
          </h1>
          <p className="text-muted-foreground text-sm">
            Клиенты смогут оставить чаевые после отзыва.
            <br />
            Деньги поступают напрямую вам через Kaspi.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="tips-toggle" className="text-base font-medium cursor-pointer">
                Включить приём чаевых
              </Label>
              <Switch
                id="tips-toggle"
                checked={tipsEnabled}
                onCheckedChange={setTipsEnabled}
                data-testid="switch-tips-enabled"
              />
            </div>

            {tipsEnabled && (
              <div className="space-y-2 pt-2">
                <Label htmlFor="kaspi-phone">Номер Kaspi</Label>
                <Input
                  id="kaspi-phone"
                  type="tel"
                  placeholder="Номер телефона Kaspi"
                  value={kaspiPhone}
                  onChange={(e) => setKaspiPhone(e.target.value)}
                  maxLength={20}
                  data-testid="input-kaspi-phone"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Button
            className="w-full"
            size="lg"
            onClick={handleSaveAndContinue}
            disabled={saving || (tipsEnabled && !kaspiPhone.trim())}
            data-testid="button-save-continue"
          >
            {saving ? 'Сохранение...' : 'Сохранить и продолжить'}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={handleSkip}
            disabled={saving}
            data-testid="button-skip"
          >
            Пропустить
          </Button>
        </div>
      </div>
    </div>
  );
}
