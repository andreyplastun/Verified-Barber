import { useState, useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useCreateReview } from "@/hooks/use-specialists";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { Star, ChevronLeft, AlertCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export default function ReviewPage() {
  const [, params] = useRoute("/review/:bookingId");
  const [, setLocation] = useLocation();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  
  const queryParams = new URLSearchParams(window.location.search);
  const specialistIdFromQuery = queryParams.get("specialistId");

  const { data: booking, isLoading: isLoadingBooking, error: bookingError } = useQuery({
    queryKey: [api.bookings.list.path, params?.bookingId, specialistIdFromQuery, currentUser?.id],
    queryFn: async () => {
      const bookingIdStr = params?.bookingId;
      const authHeaders: Record<string, string> = currentUser?.id ? { "x-user-id": currentUser.id } : {};
      
      if (bookingIdStr && bookingIdStr !== "auto") {
        const bId = parseInt(bookingIdStr);
        const url = buildUrl(api.bookings.get.path, { id: bId });
        const res = await fetch(url, { credentials: "include" });
        if (res.ok) {
          const b = await res.json();
          if (b.hasReview) {
            // Use dedicated endpoint to get review by bookingId
            const rRes = await fetch(`/api/reviews/by-booking/${bId}`, {
              credentials: "include",
              headers: authHeaders
            });
            if (rRes.ok) {
              const review = await rRes.json();
              return { ...b, review };
            }
            // If 404, review doesn't exist - proceed without it
          }
          return b;
        }
      }

      if (params?.bookingId === "auto" && specialistIdFromQuery) {
        const res = await fetch(api.bookings.list.path, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to fetch bookings");
        const allBookings = await res.json();
        const autoBooking = allBookings.find((b: any) => 
          b.specialistId === parseInt(specialistIdFromQuery) && 
          b.status === "completed"
        );
        if (!autoBooking) throw new Error("No completed visits found to review");
        
        if (autoBooking.hasReview) {
          // Use dedicated endpoint to get review by bookingId
          const rRes = await fetch(`/api/reviews/by-booking/${autoBooking.id}`, {
            credentials: "include",
            headers: authHeaders
          });
          if (rRes.ok) {
            const review = await rRes.json();
            return { ...autoBooking, review };
          }
        }
        return autoBooking;
      }

      return null;
    },
    enabled: !!params?.bookingId,
    staleTime: 0
  });

  // Fetch specialist data for avatar
  const { data: specialist } = useQuery({
    queryKey: ['/api/specialists', booking?.specialistId],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${booking?.specialistId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!booking?.specialistId,
  });

  const { toast } = useToast();
  const { mutate: createReview, isPending } = useCreateReview();

  const [hoveredStar, setHoveredStar] = useState(0);
  
  // Initialize form state from existing review (if editing) or empty (if creating)
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [triggers, setTriggers] = useState<string[]>([]);
  const [hiddenName, setHiddenName] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);

  // Trigger chips by rating
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

  // Populate form with existing review data when it becomes available
  useEffect(() => {
    if (booking?.review && !formInitialized) {
      setRating(booking.review.rating);
      setComment(booking.review.comment || "");
      setTriggers(booking.review.triggers || []);
      setHiddenName(!booking.review.showName);
      setFormInitialized(true);
    }
  }, [booking, formInitialized]);

  // Clear triggers when rating changes to different category
  const handleRatingChange = (newRating: number) => {
    const oldCategory = rating === 5 ? 'positive' : rating === 1 ? 'negative' : 'neutral';
    const newCategory = newRating === 5 ? 'positive' : newRating === 1 ? 'negative' : 'neutral';
    if (oldCategory !== newCategory) {
      setTriggers([]);
    }
    setRating(newRating);
    // Auto-enable anonymous mode for ratings 1-3
    if (newRating <= 3) {
      setHiddenName(true);
    }
  };

  // Determine if we're in edit mode based on booking data
  const isEditMode = !!booking?.review;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNewAccountPopup, setShowNewAccountPopup] = useState(false);
  const [pendingRedirectSpecialistId, setPendingRedirectSpecialistId] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking || isSubmitting) return;

    if (rating === 0) {
      toast({
        variant: "destructive",
        title: "Выберите оценку",
        description: "Пожалуйста, выберите количество звёзд.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditMode && booking.review) {
        // PATCH existing review
        const res = await fetch(`/api/reviews/${booking.review.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ rating, comment, triggers, showName: !hiddenName }),
        });
        
        if (res.ok) {
          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: ['/api/reviews'] });
          queryClient.invalidateQueries({ queryKey: ['/api/specialists'] });
          toast({ title: "Отзыв обновлён", description: "Ваши изменения сохранены." });
          setLocation(`/specialist/${booking.specialistId}`);
        } else {
          const err = await res.json();
          toast({ variant: "destructive", title: "Ошибка", description: err.message });
        }
      } else {
        // POST new review
        createReview({
          bookingId: booking.id,
          specialistId: booking.specialistId,
          rating,
          comment,
          triggers,
          showName: !hiddenName,
        }, {
          onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['/api/reviews'] });
            queryClient.invalidateQueries({ queryKey: ['/api/specialists'] });
            toast({
              title: "Отзыв опубликован",
              description: "Вы можете редактировать его в течение 5 минут.",
            });
            
            // Show popup for new accounts, then redirect
            if ((result as any).showNewAccountPopup) {
              setPendingRedirectSpecialistId(booking.specialistId);
              setShowNewAccountPopup(true);
            } else {
              setLocation(`/specialist/${booking.specialistId}`);
            }
          },
          onError: (err) => {
            toast({ variant: "destructive", title: "Ошибка", description: err.message });
          }
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const bookingIdParam = params?.bookingId;

  if (!bookingIdParam) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto w-12 h-12 text-destructive mb-4" />
        <h2 className="text-xl font-bold">Неверная ссылка</h2>
        <p className="text-muted-foreground">Информация о записи отсутствует.</p>
      </div>
    );
  }

  // Show loading while fetching booking, or while initializing form for edit mode
  // This prevents the "flash" where create form briefly appears before switching to edit
  const isFormReady = !isLoadingBooking && (!booking?.hasReview || formInitialized);
  
  if (!isFormReady) {
    return <div className="p-6 text-center animate-pulse">Загрузка данных...</div>;
  }
  
  if (bookingError || !booking) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Визит не найден</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          Мы не нашли завершённый визит для оставления отзыва.
        </p>
        <button 
          onClick={() => setLocation("/")}
          className="px-6 py-3 bg-secondary rounded-xl font-medium hover-elevate"
          data-testid="button-back-home"
        >
          На главную
        </button>
      </div>
    );
  }

  if (booking.status !== "completed") {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-8 h-8 text-yellow-500" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Визит не подтверждён</h1>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          Оставить отзыв можно только после того, как барбер подтвердит завершение визита.
        </p>
        <button 
          onClick={() => setLocation("/")}
          className="px-6 py-3 bg-secondary rounded-xl font-medium"
          data-testid="button-back-home"
        >
          На главную
        </button>
      </div>
    );
  }

  const isEditable = !booking.review || (!booking.review.isFinalized && new Date() < new Date(booking.review.editableUntil));

  if (booking.review && !isEditable) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
         <h1 className="text-2xl font-bold mb-2">Отзыв опубликован</h1>
         <p className="text-muted-foreground mb-8">Время редактирования (5 минут) истекло. Отзыв больше нельзя изменить.</p>
         <button 
          onClick={() => setLocation(`/specialist/${booking.specialistId}`)}
          className="px-6 py-3 bg-secondary rounded-xl font-medium"
          data-testid="button-view-profile"
        >
          К профилю
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="mb-8">
        <div className="flex items-center mb-4">
          <button 
            onClick={() => history.back()}
            className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
            data-testid="button-back"
          >
            <ChevronLeft size={24} />
          </button>
        </div>
        <h1 className="text-xl font-bold text-center">{isEditMode ? "Редактировать отзыв" : "Оставить отзыв"}</h1>
      </header>

      <div className="mb-8 text-center">
        {specialist?.imageUrl && (
          <div className="flex justify-center mb-4">
            <img 
              src={specialist.imageUrl} 
              alt={specialist.name}
              className="w-16 h-16 rounded-full object-cover border-2 border-background shadow-md"
              data-testid="img-specialist-avatar"
            />
          </div>
        )}
        <h2 className="text-lg font-medium">{isEditMode ? "Обновите ваш отзыв" : "Как прошёл визит?"}</h2>
        <p className="text-sm text-muted-foreground">
          {new Date(booking.appointmentTime).toLocaleDateString()}
        </p>
        {isEditable && booking.review?.editableUntil && (
          <p className="text-xs text-primary mt-2">
            Можно редактировать до: {new Date(booking.review.editableUntil).toLocaleTimeString()}
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 max-w-md mx-auto">
        {/* Star Rating */}
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
        <div className="text-center mt-2">
          <Link href="/how-trust-works" className="text-xs text-muted-foreground hover:text-primary underline" data-testid="link-how-trust-works">
            Как работает рейтинг
          </Link>
        </div>

        {/* Trigger Chips */}
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

        {/* Privacy Switch - placed right below stars */}
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
            disabled={isSubmitting || isPending}
            className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            data-testid="button-submit-review"
          >
            {isSubmitting || isPending ? "Сохранение..." : isEditMode ? "Обновить отзыв" : "Оставить отзыв"}
          </button>
        </div>
      </form>

      {/* New account info popup - custom modal for iOS compatibility */}
      {showNewAccountPopup && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => {
            setShowNewAccountPopup(false);
            if (pendingRedirectSpecialistId) {
              setLocation(`/specialist/${pendingRedirectSpecialistId}`);
            }
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
                  if (pendingRedirectSpecialistId) {
                    setLocation(`/specialist/${pendingRedirectSpecialistId}`);
                  }
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