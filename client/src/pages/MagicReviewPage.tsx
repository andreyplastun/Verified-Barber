import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, ChevronLeft, AlertCircle, Info, CheckCircle, Banknote, Heart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TipPulse, TipBadge, SlideUp, InteractiveStarRating, TipConfirmPulse, TipIconFloat } from "@/components/ui/animations";

type Lang = "ru" | "kz";

const t = {
  ru: {
    pageTitle: "Оставить отзыв",
    howWasVisit: (name: string) => `Как прошёл визит к ${name}?`,
    shareImpressions: (name: string) => `${name}, поделитесь впечатлениями`,
    commentLabel: "Комментарий",
    commentPlaceholder: "Добавьте детали...",
    submitting: "Отправка...",
    submitButton: "Оставить отзыв",
    triggersPositive: ["Понравилась стрижка", "Аккуратно", "Вежливый", "Профессионал", "Хочу прийти ещё"],
    triggersNegative: [
      "Не понял запрос", "Неаккуратно", "Спешил", "Не услышал пожелания",
      "Результат не устроил", "Долго ждал мастера", "Не понравилась стрижка",
      "Слишком коротко", "Гигиена мастера", "Уровень салона",
      "Итоговая цена отличалась от заявленной",
    ],
    triggerTitle5: "Что особенно запомнилось?",
    triggerTitle4: "Что ухудшило впечатление?",
    triggerTitleLow: "Что испортило опыт?",
    anonLabel: "Показывать отзыв анонимно",
    anonTooltip: "Мастер увидит отзыв, но без вашего имени",
    successTitle: "Спасибо за отзыв!",
    successText: (name: string) => `Ваш отзыв о барбере ${name} опубликован.`,
    viewProfile: "Посмотреть профиль",
    tipsTitle: "Хотите оставить чаевые?",
    tipsDescription: "Это необязательно. Деньги поступят напрямую мастеру через Kaspi.",
    tipsSkip: "Пропустить",
    tipsTransfer: "Переведите в Kaspi:",
    tipsAmount: "Сумма:",
    tipsPhone: "Номер:",
    tipsDone: "Я перевёл чаевые",
    tipsBack: "Назад",
    tipsCustom: "Другая сумма",
    thanksTitle: "Спасибо!",
    thanksText: "Если вы оставили чаевые — мастеру будет приятно",
    thanksReturn: "Вернуться",
    errorTitle: "Ссылка больше не активна",
    errorExpired: "Срок действия ссылки истёк.",
    errorUsed: "Эта ссылка уже была использована.",
    errorReviewExists: "Отзыв уже оставлен для этого визита.",
    errorDefault: "Вы можете оставить отзыв, войдя в приложение вручную.",
    errorLogin: "Войти в приложение",
    selectRating: "Выберите оценку",
    selectRatingDesc: "Пожалуйста, выберите количество звёзд.",
    loadingLink: "Проверка ссылки...",
    trustLink: "Как формируется доверие в Rateus",
    geoTrust: "Геолокация подтверждена — доверие к отзыву повышено",
    geoRequest: "Подтвердим, что вы были у мастера — это повышает доверие к отзыву",
    errorToast: "Ошибка",
    newAccountTitle: "Почему этот отзыв может не влиять на рейтинг?",
    newAccountP1: "Мы показываем все отзывы. Но для расчёта рейтинга учитываются отзывы от пользователей, которые уже немного знакомы с сервисом.",
    newAccountP2: "Ваш отзыв будет виден другим пользователям и поможет мастеру, а на рейтинг он начнёт влиять чуть позже.",
    newAccountButton: "Понятно",
  },
  kz: {
    pageTitle: "Пікір қалдыру",
    howWasVisit: (name: string) => `${name} қабылдауы қалай өтті?`,
    shareImpressions: (name: string) => `${name}, әсеріңізбен бөлісіңіз`,
    commentLabel: "Пікір",
    commentPlaceholder: "Толығырақ жазыңыз...",
    submitting: "Жіберу...",
    submitButton: "Пікір қалдыру",
    triggersPositive: ["Шаш қию ұнады", "Ұқыпты", "Сыпайы", "Кәсіби", "Тағы келгім келеді"],
    triggersNegative: [
      "Ұқыпсыз", "Асықты", "Тілектерімді ескермеді",
      "Нәтиже көңілімнен шықпады", "Мастерді ұзақ күттім", "Шаш қию ұнамады",
      "Тым қысқа", "Мастердің гигиенасы", "Салон деңгейі",
      "Соңғы баға айтылғаннан өзгеше болды",
    ],
    triggerTitle5: "Ең ерекше не есте қалды?",
    triggerTitle4: "Әсерді не нашарлатты?",
    triggerTitleLow: "Тәжірибені не бұзды?",
    anonLabel: "Пікірді анонимді түрде көрсету",
    anonTooltip: "Мастер пікірді көреді, бірақ сіздің атыңызсыз",
    successTitle: "Пікіріңіз үшін рақмет!",
    successText: (name: string) => `${name} барбер туралы пікіріңіз жарияланды.`,
    viewProfile: "Профильді көру",
    tipsTitle: "Шайпұл қалдырғыңыз келе ме?",
    tipsDescription: "Бұл міндетті емес. Ақша тікелей мастерге Kaspi арқылы түседі.",
    tipsSkip: "Өткізіп жіберу",
    tipsTransfer: "Kaspi арқылы аударыңыз:",
    tipsAmount: "Сома:",
    tipsPhone: "Нөмір:",
    tipsDone: "Мен шайпұл аудардым",
    tipsBack: "Артқа",
    tipsCustom: "Басқа сома",
    thanksTitle: "Рақмет!",
    thanksText: "Егер сіз шайпұл қалдырсаңыз — мастерге жағымды болады",
    thanksReturn: "Артқа",
    errorTitle: "Сілтеме енді белсенді емес",
    errorExpired: "Сілтеменің жарамдылық мерзімі аяқталды.",
    errorUsed: "Бұл сілтеме бұрын қолданылған.",
    errorReviewExists: "Пікір әлдеқашан қалдырылған.",
    errorDefault: "Сілтеме енді белсенді емес.",
    errorLogin: "Қосымшаға кіру",
    selectRating: "Бағаны таңдаңыз",
    selectRatingDesc: "Жұлдыздар санын таңдаңыз.",
    loadingLink: "Сілтемені тексеру...",
    trustLink: "Rateus-та сенім қалай қалыптасады",
    geoTrust: "Геолокация расталды — пікірге сенім артты",
    geoRequest: "Сіздің шеберде болғаныңызды растаймыз — бұл пікірге сенімді арттырады",
    errorToast: "Қате",
    newAccountTitle: "Бұл пікір рейтингке неге әсер етпеуі мүмкін?",
    newAccountP1: "Біз барлық пікірлерді көрсетеміз. Бірақ рейтингті есептеу үшін сервиспен танысқан пайдаланушылардың пікірлері ескеріледі.",
    newAccountP2: "Сіздің пікіріңіз басқа пайдаланушыларға көрінеді және мастерге көмектеседі, ал рейтингке кейінірек әсер ете бастайды.",
    newAccountButton: "Түсінікті",
  },
};

function getLangFromUrl(): Lang {
  const params = new URLSearchParams(window.location.search);
  const lang = params.get("lang");
  return lang === "kz" ? "kz" : "ru";
}

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
  token?: string;
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
  bookingSource?: string;
}

export default function MagicReviewPage() {
  const [, tokenParams] = useRoute("/r/:token");
  const [, reviewParams] = useRoute("/review/:slug/:code");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const token = tokenParams?.token;
  const slug = reviewParams?.slug;
  const code = reviewParams?.code;
  const isShortLink = !!(slug && code);
  const lang = useMemo(getLangFromUrl, []);
  const L = t[lang];

  const { data: linkData, isLoading, error } = useQuery<MagicLinkData>({
    queryKey: isShortLink ? ['/api/review', slug, code] : ['/api/magic-link', token],
    queryFn: async () => {
      const url = isShortLink ? `/api/review/${slug}/${code}` : `/api/magic-link/${token}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw { status: res.status, ...data };
      }
      return data;
    },
    enabled: isShortLink ? !!(slug && code) : !!token,
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
  const [geoData, setGeoData] = useState<{ lat: number; lng: number; status: string } | null>(null);
  
  const openedTrackedRef = useRef(false);
  const screenLoadedTrackedRef = useRef(false);
  const geoRequestedRef = useRef(false);

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

  useEffect(() => {
    if (!linkData?.valid || geoRequestedRef.current) return;
    if (linkData.bookingSource === "altegio") {
      geoRequestedRef.current = true;
      return;
    }
    if (navigator.geolocation) {
      geoRequestedRef.current = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGeoData({ lat: pos.coords.latitude, lng: pos.coords.longitude, status: "ok" });
        },
        () => {
          setGeoData({ lat: 0, lng: 0, status: "no_permission" });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    } else {
      setGeoData({ lat: 0, lng: 0, status: "error" });
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

  const triggersByRating: Record<number, string[]> = {
    5: L.triggersPositive,
    4: L.triggersNegative,
    3: L.triggersNegative,
    2: L.triggersNegative,
    1: L.triggersNegative,
  };

  const triggerTitle = rating === 5
    ? L.triggerTitle5
    : rating === 4
      ? L.triggerTitle4
      : L.triggerTitleLow;

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

  const activeToken = linkData?.token || token;
  const submitMutation = useMutation({
    mutationFn: async (data: { rating: number; comment: string; triggers: string[]; showName: boolean; priceMismatch: boolean; geoLat?: number; geoLng?: number; geoStatus?: string }) => {
      const res = await fetch(`/api/r/${activeToken}`, {
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
      toast({ variant: "destructive", title: L.errorToast, description: err.message });
    },
  });

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (rating === 0) {
      toast({
        variant: "destructive",
        title: L.selectRating,
        description: L.selectRatingDesc,
      });
      return;
    }
    const priceTrigger = L.triggersNegative[L.triggersNegative.length - 1];
    submitMutation.mutate({ 
      rating, comment, triggers, showName: !hiddenName, priceMismatch: triggers.includes(priceTrigger),
      ...(geoData?.status === "ok" ? { geoLat: geoData.lat, geoLng: geoData.lng, geoStatus: "ok" } : { geoStatus: geoData?.status || "no_permission" }),
    });
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
          <p className="text-muted-foreground">{L.loadingLink}</p>
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
        <h2 className="text-2xl font-bold mb-2">{L.errorTitle}</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          {reason === 'expired' && L.errorExpired}
          {reason === 'used' && L.errorUsed}
          {reason === 'review_exists' && L.errorReviewExists}
          {!['expired', 'used', 'review_exists'].includes(reason) && L.errorDefault}
        </p>
        <button 
          onClick={() => setLocation("/login")}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
          data-testid="button-go-login"
        >
          {L.errorLogin}
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
          <h2 className="text-2xl font-bold mb-2">{L.thanksTitle}</h2>
          <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
            {L.thanksText}
          </p>
          <button 
            onClick={() => setLocation(`/specialist/${linkData?.specialistId}`)}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
            data-testid="button-return-after-tips"
          >
            {L.thanksReturn}
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
        <h2 className="text-2xl font-bold mb-2">{L.tipsTitle}</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          {L.tipsDescription}
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
                placeholder={L.tipsCustom}
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
              {L.tipsSkip}
            </button>
          </>
        ) : (
          <div className="space-y-4 w-full max-w-xs">
            <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2">
              <p className="text-sm text-muted-foreground">{L.tipsTransfer}</p>
              <p className="text-lg font-bold" data-testid="text-tip-amount">{L.tipsAmount} {selectedTipAmount.toLocaleString('ru-KZ')} ₸</p>
              <p className="text-lg font-mono" data-testid="text-tip-phone">{L.tipsPhone} {formatKaspiPhone(linkData.kaspiPhone!)}</p>
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
              {L.tipsDone}
            </Button>
            <button 
              onClick={() => setSelectedTipAmount(null)}
              className="text-muted-foreground text-sm hover:underline block mx-auto"
              data-testid="button-back-tips"
            >
              {L.tipsBack}
            </button>
            <button 
              onClick={skipTips}
              className="text-muted-foreground text-sm hover:underline block mx-auto"
              data-testid="button-skip-after-select"
            >
              {L.tipsSkip}
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
        <h2 className="text-2xl font-bold mb-2">{L.successTitle}</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          {L.successText(linkData?.specialistName || '')}
        </p>
        <button 
          onClick={() => setLocation(`/specialist/${linkData?.specialistId}`)}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity"
          data-testid="button-view-specialist"
        >
          {L.viewProfile}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 pb-48">
      <header className="flex items-center gap-4 mb-8">
        <div className="w-10 h-10" />
        <h1 className="text-xl font-bold">{L.pageTitle}</h1>
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
        <h2 className="text-lg font-medium">{L.howWasVisit(lang === 'ru' ? toDativeCase(linkData.specialistName) : linkData.specialistName)}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {L.shareImpressions(linkData.customerName)}
        </p>
      </div>

      {geoData && (
        <div className="max-w-md mx-auto mb-4" data-testid="geo-status-badge">
          {geoData.status === "ok" ? (
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
              <CheckCircle size={14} />
              <span>{L.geoTrust}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              <Info size={14} />
              <span>{L.geoRequest}</span>
            </div>
          )}
        </div>
      )}

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
              {L.anonLabel}
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
                <p>{L.anonTooltip}</p>
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
          <label className="text-sm font-medium ml-1">{L.commentLabel}</label>
          <textarea
            rows={3}
            className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
            placeholder={L.commentPlaceholder}
            value={comment}
            onChange={e => setComment(e.target.value)}
            data-testid="textarea-comment"
          />
        </div>

        <div className="text-center pt-2">
          <Link href="/how-trust-works" className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 transition-colors" data-testid="link-how-trust-works-magic">
            {L.trustLink}
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
          {submitMutation.isPending ? L.submitting : L.submitButton}
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
              {L.newAccountTitle}
            </h3>
            <div className="text-sm text-muted-foreground space-y-3">
              <p>{L.newAccountP1}</p>
              <p>{L.newAccountP2}</p>
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
                {L.newAccountButton}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
