import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, ChevronLeft, AlertCircle, Info, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface MagicLinkData {
  valid: boolean;
  userId: string;
  bookingId: number;
  specialistId: number;
  specialistName: string;
  customerName: string;
  reason?: string;
}

export default function MagicReviewPage() {
  const [, params] = useRoute("/magic-review/:token");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const token = params?.token;

  const { data: linkData, isLoading, error } = useQuery<MagicLinkData>({
    queryKey: ['/api/magic-link', token],
    queryFn: async () => {
      const res = await fetch(`/api/magic-link/${token}`);
      const data = await res.json();
      if (!res.ok) {
        throw { status: res.status, ...data };
      }
      return data;
    },
    enabled: !!token,
    retry: false,
  });

  const [hoveredStar, setHoveredStar] = useState(0);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [triggers, setTriggers] = useState<string[]>([]);
  const [hiddenName, setHiddenName] = useState(false);
  const [showNewAccountPopup, setShowNewAccountPopup] = useState(false);
  const [showSuccessScreen, setShowSuccessScreen] = useState(false);

  const triggersByRating: Record<number, string[]> = {
    5: ["Понравилась стрижка", "Аккуратно", "Вежливый", "Профессионал", "Хочу прийти ещё"],
    4: ["Долго ждал", "Не понял результат", "Неаккуратно", "Не услышал пожелания"],
    3: ["Долго ждал", "Не понял результат", "Неаккуратно", "Не услышал пожелания"],
    2: ["Долго ждал", "Не понял результат", "Неаккуратно", "Не услышал пожелания"],
    1: ["Не понравилась стрижка", "Невежливо", "Плохо объяснил", "Не рекомендую"],
  };

  const availableTriggers = rating > 0 ? (triggersByRating[rating] || []) : [];

  const toggleTrigger = (trigger: string) => {
    setTriggers(prev => 
      prev.includes(trigger) 
        ? prev.filter(t => t !== trigger)
        : [...prev, trigger]
    );
  };

  const handleRatingChange = (newRating: number) => {
    const oldCategory = rating === 5 ? 'positive' : rating === 1 ? 'negative' : 'neutral';
    const newCategory = newRating === 5 ? 'positive' : newRating === 1 ? 'negative' : 'neutral';
    if (oldCategory !== newCategory) {
      setTriggers([]);
    }
    setRating(newRating);
  };

  const submitMutation = useMutation({
    mutationFn: async (data: { rating: number; comment: string; triggers: string[]; showName: boolean }) => {
      const res = await fetch(`/api/magic-review/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message);
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/reviews'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists'] });
      
      if (result.showNewAccountPopup) {
        setShowNewAccountPopup(true);
      } else {
        setShowSuccessScreen(true);
      }
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Ошибка", description: err.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) {
      toast({
        variant: "destructive",
        title: "Выберите оценку",
        description: "Пожалуйста, выберите количество звёзд.",
      });
      return;
    }
    submitMutation.mutate({ rating, comment, triggers, showName: !hiddenName });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Проверка ссылки...</p>
        </div>
      </div>
    );
  }

  if (error || !linkData?.valid) {
    const errorData = error as any;
    const reason = errorData?.reason || 'unknown';
    
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Ссылка больше не активна</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          {reason === 'expired' && 'Срок действия ссылки истёк (24 часа).'}
          {reason === 'used' && 'Эта ссылка уже была использована.'}
          {reason === 'review_exists' && 'Отзыв уже оставлен для этого визита.'}
          {!['expired', 'used', 'review_exists'].includes(reason) && 'Вы можете оставить отзыв, войдя в приложение вручную.'}
        </p>
        <button 
          onClick={() => setLocation("/login")}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
          data-testid="button-go-login"
        >
          Войти в приложение
        </button>
      </div>
    );
  }

  if (showSuccessScreen) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Спасибо за отзыв!</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          Ваш отзыв о специалисте {linkData.specialistName} опубликован.
        </p>
        <button 
          onClick={() => setLocation(`/specialist/${linkData.specialistId}`)}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
          data-testid="button-view-specialist"
        >
          Посмотреть профиль
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 pb-24">
      <header className="flex items-center gap-4 mb-8">
        <div className="w-10 h-10" />
        <h1 className="text-xl font-bold">Оставить отзыв</h1>
      </header>

      <div className="mb-8 text-center">
        <h2 className="text-lg font-medium">Как прошёл визит к {linkData.specialistName}?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {linkData.customerName}, поделитесь впечатлениями
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 max-w-md mx-auto">
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onMouseEnter={() => setHoveredStar(star)}
              onMouseLeave={() => setHoveredStar(0)}
              onClick={() => handleRatingChange(star)}
              className="p-1 transition-transform hover:scale-110 focus:outline-none"
              data-testid={`button-star-${star}`}
            >
              <Star 
                size={40} 
                className={`
                  transition-colors duration-200
                  ${star <= (hoveredStar || rating) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/30"}
                `} 
              />
            </button>
          ))}
        </div>

        {rating > 0 && availableTriggers.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">Что запомнилось?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {availableTriggers.map((trigger) => (
                <button
                  key={trigger}
                  type="button"
                  onClick={() => toggleTrigger(trigger)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    triggers.includes(trigger)
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover-elevate"
                  }`}
                  data-testid={`chip-${trigger}`}
                >
                  {trigger}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 py-2">
          <div className="flex items-center gap-2">
            <label htmlFor="hidden-name-toggle" className="text-sm font-medium cursor-pointer">
              Скрыть моё имя
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <button 
                  type="button" 
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted"
                  data-testid="button-privacy-info"
                >
                  <Info size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" className="max-w-xs text-sm p-3">
                <p>Если включено — отзыв будет анонимным. Мастер и другие клиенты не увидят ваше имя.</p>
              </PopoverContent>
            </Popover>
          </div>
          <Switch
            id="hidden-name-toggle"
            checked={hiddenName}
            onCheckedChange={setHiddenName}
            data-testid="switch-hidden-name"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Комментарий <span className="text-muted-foreground">(необязательно)</span></label>
          <textarea
            rows={3}
            className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
            placeholder="Добавьте детали..."
            value={comment}
            onChange={e => setComment(e.target.value)}
            data-testid="textarea-comment"
          />
        </div>

        <div className="space-y-3">
          <button
            type="submit"
            disabled={submitMutation.isPending}
            className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            data-testid="button-submit-review"
          >
            {submitMutation.isPending ? "Отправка..." : "Опубликовать"}
          </button>
        </div>
      </form>

      {showNewAccountPopup && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => {
            setShowNewAccountPopup(false);
            setShowSuccessScreen(true);
          }}
        >
          <div 
            className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-[#1F2933] mb-4">
              Почему этот отзыв может не влиять на рейтинг?
            </h3>
            <div className="text-sm text-[#6B7280] space-y-3">
              <p>
                Мы показываем все отзывы.
                Но для расчёта рейтинга учитываются отзывы от пользователей, которые уже немного знакомы с сервисом.
              </p>
              <p>
                Ваш отзыв будет виден другим пользователям и поможет мастеру,
                а на рейтинг он начнёт влиять чуть позже.
              </p>
            </div>
            <div className="mt-4">
              <Button 
                onClick={() => {
                  setShowNewAccountPopup(false);
                  setShowSuccessScreen(true);
                }}
                className="w-full"
                data-testid="button-popup-understand"
              >
                Понятно
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
