import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Star, ListChecks } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Specialist } from '@shared/schema';

const STEPS = [
  'Добавьте фото',
  'Укажите основную услугу и цену',
  'Добавьте способ записи',
  'Получите первый отзыв',
];

function pluralizeReviews(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'отзыв';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'отзыва';
  return 'отзывов';
}

export default function SpecialistOnboarding() {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // The catalog endpoint returns only active specialists, best profiles first.
  // Use the top one as a real "example profile" the new specialist can aspire to.
  const { data: specialists } = useQuery<Specialist[]>({
    queryKey: ['/api/specialists'],
  });
  const example = (specialists || []).find((s) => !!s.imageUrl) || (specialists || [])[0];
  const exampleRating = example ? (Number(example.trustedRating) / 10) : 0;
  const exampleReviews = example?.reviewCount || 0;

  const handleStart = async () => {
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
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold" data-testid="text-onboarding-title">
            Добро пожаловать в Rateus
          </h1>
          <p className="text-muted-foreground text-sm">
            Rateus помогает собирать отзывы клиентов и формировать вашу
            профессиональную репутацию.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-sm font-medium text-foreground">
              Чтобы начать получать отзывы:
            </p>
            <ul className="space-y-2.5">
              {STEPS.map((step, i) => (
                <li key={i} className="flex items-center gap-3" data-testid={`onboarding-step-${i}`}>
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span className="text-sm text-foreground">{step}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-primary/30 bg-primary/5" data-testid="card-example-profile">
          <CardContent className="pt-5 pb-5">
            <p className="text-xs text-muted-foreground mb-3">Пример профиля специалиста</p>
            <div className="flex items-center gap-4">
              {example?.imageUrl ? (
                <img
                  src={example.imageUrl}
                  alt={example.name}
                  className="w-14 h-14 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center text-lg font-bold text-primary shrink-0">
                  {(example?.name || 'Ж').charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground truncate" data-testid="text-example-name">
                  {example?.name || 'Жасур'}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-1 text-sm">
                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    {example && exampleRating > 0 ? exampleRating.toFixed(1) : '5.0'}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {example ? `${exampleReviews} ${pluralizeReviews(exampleReviews)}` : '19 отзывов'}
                  </span>
                </div>
              </div>
            </div>
            {example && (
              <a
                href={`/specialist/${example.id}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="link-view-example"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-4"
                  data-testid="button-view-example"
                >
                  Посмотреть пример профиля
                </Button>
              </a>
            )}
          </CardContent>
        </Card>

        <Button
          className="w-full gap-1.5"
          size="lg"
          onClick={handleStart}
          disabled={saving}
          data-testid="button-fill-profile"
        >
          <ListChecks className="w-4 h-4" />
          {saving ? 'Загрузка...' : 'Заполнить профиль'}
        </Button>
      </div>
    </div>
  );
}
