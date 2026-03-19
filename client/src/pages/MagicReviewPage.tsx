import { useState, useEffect, useRef } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, ChevronLeft, AlertCircle, Info, CheckCircle, Banknote, Heart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TipPulse, TipBadge, SlideUp, InteractiveStarRating, TipConfirmPulse, TipIconFloat } from "@/components/ui/animations";

function toDativeCase(name: string): string {
  const n = name.trim();
  if (!n) return n;
  
  const lastChar = n.slice(-1).toLowerCase();
  const lastTwoChars = n.slice(-2).toLowerCase();
  
  if (lastTwoChars === 'ий' || lastTwoChars === 'ей') {
    return n.slice(0, -2) + 'ию';
  }
  if (lastTwoChars === 'ия' || lastTwoChars === 'ья') {
    return n.slice(0, -1) + 'е';
  }
  if (lastChar === 'а') {
    return n.slice(0, -1) + 'е';
  }
  if (lastChar === 'я') {
    return n.slice(0, -1) + 'е';
  }
  if (lastChar === 'ь') {
    return n.slice(0, -1) + 'ю';
  }
  if (lastChar === 'й') {
    return n.slice(0, -1) + 'ю';
  }
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(n)) {
    return n + 'у';
  }
  return n;
}

interface MagicLinkData {
  valid: boolean;
  magicLinkId: number;
  userId: string | null;
  bookingId: number;
  specialistId: number;
  specialistName: string;
  specialistImageUrl?: string | null;
  customerName: string;
  isPhoneOnly?: boolean;
  reason?: string;
  tipsEnabled?: boolean;
  kaspiPhone?: string | null;
  sentAt?: string;
  baseServicePrice?: number | null;
}

export default function MagicReviewPage() {
  const [, params] = useRoute("/r/:token");
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
  const [showTipsScreen, setShowTipsScreen] = useState(false);
  const [showThankYouScreen, setShowThankYouScreen] = useState(false);
  const [customTipAmount, setCustomTipAmount] = useState('');
  
  const openedTrackedRef = useRef(false);
  const screenLoadedTrackedRef = useRef(false);

  const trackEvent = async (eventType: string, extraData?: Record<string, any>) => {
    try {
      await fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          magicLinkId: linkData?.magicLinkId,
          bookingId: linkData?.bookingId,
          specialistId: linkData?.specialistId,
          sentAt: linkData?.sentAt,
          userAgent: navigator.userAgent,
          source: 'whatsapp',
          ...extraData,
        }),
      });
    } catch (e) {
      // Ignore analytics errors - don't disrupt user experience
    }
  };

  // Track magic_link_opened when page loads and we have valid link data
  useEffect(() => {
    if (linkData?.valid && !openedTrackedRef.current) {
      openedTrackedRef.current = true;
      trackEvent('magic_link_opened');
    }
  }, [linkData]);

  // Track review_screen_loaded when form is fully rendered
  useEffect(() => {
    if (linkData?.valid && !isLoading && !error && !screenLoadedTrackedRef.current) {
      screenLoadedTrackedRef.current = true;
      // Small delay to ensure DOM is fully rendered
      const timer = setTimeout(() => {
        trackEvent('review_screen_loaded');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [linkData, isLoading, error]);

  const negativeTriggers = [
    "Не понял запрос", "Неаккуратно", "Спешил", "Не услышал пожелания",
    "Результат не устроил", "Долго ждал мастера", "Не понравилась стрижка",
    "Слишком коротко", "Гигиена мастера", "Уровень салона",
    "Итоговая цена отличалась от заявленной",
  ];

  const triggersByRating: Record<number, string[]> = {
    5: ["Понравилась стрижка", "Аккуратно", "Вежливый", "Профессионал", "Хочу прийти ещё"],
    4: negativeTriggers,
    3: negativeTriggers,
    2: negativeTriggers,
    1: negativeTriggers,
  };

  const triggerTitle = rating === 5
    ? "Что особенно запомнилось?"
    : rating === 4
      ? "Что ухудшило впечатление?"
      : "Что испортило опыт?";

  const availableTriggers = rating > 0 ? (triggersByRating[rating] || []) : [];

  const toggleTrigger = (trigger: string) => {
    setTriggers(prev => 
      prev.includes(trigger) 
        ? prev.filter(t => t !== trigger)
        : [...prev, trigger]
    );
  };

  const handleRatingChange = (newRating: number) => {
    const oldCategory = rating === 5 ? 'positive' : 'negative';
    const newCategory = newRating === 5 ? 'positive' : 'negative';
    if (oldCategory !== newCategory) {
      setTriggers([]);
    }
    setRating(newRating);
    if (newRating <= 3) {
      setHiddenName(true);
    }
  };

  const submitMutation = useMutation({
    mutationFn: async (data: { rating: number; comment: string; triggers: string[]; showName: boolean; priceMismatch: boolean }) => {
      const res = await fetch(`/api/r/${token}`, {
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
      } else if (linkData?.tipsEnabled && linkData?.kaspiPhone) {
        setShowTipsScreen(true);
      } else {
        setShowSuccessScreen(true);
      }
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Ошибка", description: err.message });
    },
  });

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (rating === 0) {
      toast({
        variant: "destructive",
        title: "Выберите оценку",
        description: "Пожалуйста, выберите количество звёзд.",
      });
      return;
    }
    submitMutation.mutate({ rating, comment, triggers, showName: !hiddenName, priceMismatch: triggers.includes("Итоговая цена отличалась от заявленной") });
  };

  const [selectedTipAmount, setSelectedTipAmount] = useState<number | null>(null);

  const formatKaspiPhone = (phone: string) => {
    const digits = phone.replace(/[^0-9]/g, '').slice(-11);
    return `+${digits.slice(0,1)} ${digits.slice(1,4)} ${digits.slice(4,7)} ${digits.slice(7,9)} ${digits.slice(9,11)}`;
  };

  const handleTipClick = (amount: number) => {
    setSelectedTipAmount(amount);
  };

  const handleCustomTip = () => {
    const amount = parseInt(customTipAmount);
    if (amount > 0) {
      handleTipClick(amount);
    }
  };

  const skipTips = () => {
    setShowTipsScreen(false);
    setShowSuccessScreen(true);
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
          {reason === 'expired' && 'Срок действия ссылки истёк.'}
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

  if (showThankYouScreen) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <SlideUp>
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6 mx-auto">
            <Heart className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Спасибо!</h2>
          <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
            Если вы оставили чаевые — мастеру будет приятно
          </p>
          <button 
            onClick={() => setLocation(`/specialist/${linkData?.specialistId}`)}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
            data-testid="button-return-after-tips"
          >
            Вернуться
          </button>
        </SlideUp>
      </div>
    );
  }

  if (showTipsScreen && linkData) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <TipIconFloat trigger={showTipsScreen}>
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mb-6">
            <Banknote className="w-8 h-8 text-amber-600" />
          </div>
        </TipIconFloat>
        <h2 className="text-2xl font-bold mb-2">Хотите оставить чаевые?</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          Это необязательно. Деньги поступят напрямую мастеру через Kaspi.
        </p>
        
        {!selectedTipAmount ? (
          <>
            <TipPulse trigger={showTipsScreen}>
              <div className="flex flex-wrap justify-center gap-3 mb-6 max-w-sm">
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => handleTipClick(500)}
                  className="min-w-[100px]"
                  data-testid="button-tip-500"
                >
                  500 ₸
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => handleTipClick(1000)}
                  className="min-w-[100px]"
                  data-testid="button-tip-1000"
                >
                  1 000 ₸
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => handleTipClick(2000)}
                  className="min-w-[100px]"
                  data-testid="button-tip-2000"
                >
                  2 000 ₸
                </Button>
              </div>
            </TipPulse>

            <div className="flex items-center gap-2 mb-8 max-w-xs w-full">
              <Input
                type="number"
                placeholder="Другая сумма"
                value={customTipAmount}
                onChange={(e) => setCustomTipAmount(e.target.value)}
                className="text-center"
                data-testid="input-custom-tip"
              />
              <Button
                onClick={handleCustomTip}
                disabled={!customTipAmount || parseInt(customTipAmount) <= 0}
                data-testid="button-send-custom-tip"
              >
                ₸
              </Button>
            </div>

            <button 
              onClick={skipTips}
              className="text-muted-foreground text-sm hover:underline"
              data-testid="button-skip-tips"
            >
              Пропустить
            </button>
          </>
        ) : (
          <div className="space-y-4 w-full max-w-xs">
            <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2">
              <p className="text-sm text-muted-foreground">Переведите в Kaspi:</p>
              <p className="text-lg font-bold" data-testid="text-tip-amount">Сумма: {selectedTipAmount.toLocaleString('ru-KZ')} ₸</p>
              <p className="text-lg font-mono" data-testid="text-tip-phone">Номер: {formatKaspiPhone(linkData.kaspiPhone!)}</p>
            </div>
            <Button
              size="lg"
              onClick={() => {
                setShowTipsScreen(false);
                setShowThankYouScreen(true);
              }}
              className="w-full"
              data-testid="button-completed-payment"
            >
              Я перевёл чаевые
            </Button>
            <button 
              onClick={() => setSelectedTipAmount(null)}
              className="text-muted-foreground text-sm hover:underline block mx-auto"
              data-testid="button-back-tips"
            >
              Назад
            </button>
            <button 
              onClick={skipTips}
              className="text-muted-foreground text-sm hover:underline block mx-auto"
              data-testid="button-skip-after-select"
            >
              Пропустить
            </button>
          </div>
        )}
      </div>
    );
  }

  if (showSuccessScreen) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Спасибо за отзыв!</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          Ваш отзыв о барбере {linkData?.specialistName} опубликован.
        </p>
        <button 
          onClick={() => setLocation(`/specialist/${linkData?.specialistId}`)}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
          data-testid="button-view-specialist"
        >
          Посмотреть профиль
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 pb-48">
      <header className="flex items-center gap-4 mb-8">
        <div className="w-10 h-10" />
        <h1 className="text-xl font-bold">Оставить отзыв</h1>
      </header>

      <div className="mb-8 text-center">
        {linkData.specialistImageUrl && (
          <div className="flex justify-center mb-4">
            <img 
              src={linkData.specialistImageUrl} 
              alt={linkData.specialistName}
              className="w-16 h-16 rounded-full object-cover border-2 border-background shadow-md"
              data-testid="img-specialist-avatar"
            />
          </div>
        )}
        <h2 className="text-lg font-medium">Как прошёл визит к {toDativeCase(linkData.specialistName)}?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {linkData.customerName}, поделитесь впечатлениями
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 max-w-md mx-auto">
        <InteractiveStarRating
          rating={rating}
          hoveredStar={hoveredStar}
          onRate={handleRatingChange}
          onHover={setHoveredStar}
          onLeave={() => setHoveredStar(0)}
          size={40}
        />

        {rating > 0 && availableTriggers.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">{triggerTitle}</p>
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
              Показывать отзыв анонимно
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
                <p>Мастер увидит отзыв, но без вашего имени</p>
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

        <div className="text-center pt-2">
          <Link href="/how-trust-works" className="text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-how-trust-works-magic">
            Как формируется доверие в Rateus
          </Link>
        </div>
      </form>

      <div className="fixed bottom-0 left-0 right-0 z-[60] p-4 pb-6 bg-background border-t border-border">
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={submitMutation.isPending}
          className="w-full max-w-md mx-auto block py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          data-testid="button-submit-review"
        >
          {submitMutation.isPending ? "Отправка..." : "Оставить отзыв"}
        </button>
      </div>

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
            className="bg-card rounded-lg p-6 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground mb-4">
              Почему этот отзыв может не влиять на рейтинг?
            </h3>
            <div className="text-sm text-muted-foreground space-y-3">
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
