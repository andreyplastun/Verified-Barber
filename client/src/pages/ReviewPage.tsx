import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useCreateReview } from "@/hooks/use-specialists";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { Star, ChevronLeft, AlertCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";

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

  const { toast } = useToast();
  const { mutate: createReview, isPending } = useCreateReview();

  const [hoveredStar, setHoveredStar] = useState(0);
  
  // Initialize form state from existing review (if editing) or empty (if creating)
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [hiddenName, setHiddenName] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);

  // Populate form with existing review data when it becomes available
  useEffect(() => {
    if (booking?.review && !formInitialized) {
      setRating(booking.review.rating);
      setComment(booking.review.comment || "");
      setHiddenName(!booking.review.showName);
      setFormInitialized(true);
    }
  }, [booking, formInitialized]);

  // Determine if we're in edit mode based on booking data
  const isEditMode = !!booking?.review;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking || isSubmitting) return;

    if (rating === 0) {
      toast({
        variant: "destructive",
        title: "Rating required",
        description: "Please select a star rating.",
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
          body: JSON.stringify({ rating, comment, showName: !hiddenName }),
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
          showName: !hiddenName,
        }, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/reviews'] });
            queryClient.invalidateQueries({ queryKey: ['/api/specialists'] });
            toast({
              title: "Отзыв опубликован",
              description: "Вы можете редактировать его в течение 5 минут.",
            });
            setLocation(`/specialist/${booking.specialistId}`);
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
        <h2 className="text-xl font-bold">Invalid Link</h2>
        <p className="text-muted-foreground">Booking information is missing.</p>
      </div>
    );
  }

  // Only show loading while fetching the booking itself
  if (isLoadingBooking) {
    return <div className="p-6 text-center animate-pulse">Загрузка данных...</div>;
  }
  
  if (bookingError || !booking) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold mb-2">No Verified Visit Found</h2>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          We couldn't find a completed visit for you to review at this time.
        </p>
        <button 
          onClick={() => setLocation("/")}
          className="px-6 py-3 bg-secondary rounded-xl font-medium hover-elevate"
          data-testid="button-back-home"
        >
          Back Home
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
        <h1 className="text-2xl font-bold mb-2">Visit Not Verified</h1>
        <p className="text-muted-foreground mb-8 max-w-xs mx-auto">
          You can only review after your visit is marked as completed by the specialist.
        </p>
        <button 
          onClick={() => setLocation("/")}
          className="px-6 py-3 bg-secondary rounded-xl font-medium"
          data-testid="button-back-home"
        >
          Back Home
        </button>
      </div>
    );
  }

  const isEditable = !booking.review || (!booking.review.isFinalized && new Date() < new Date(booking.review.editableUntil));

  if (booking.review && !isEditable) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
         <h1 className="text-2xl font-bold mb-2">Review Finalized</h1>
         <p className="text-muted-foreground mb-8">The 5-minute editing window has expired. This review can no longer be modified.</p>
         <button 
          onClick={() => setLocation(`/specialist/${booking.specialistId}`)}
          className="px-6 py-3 bg-secondary rounded-xl font-medium"
          data-testid="button-view-profile"
        >
          View Profile
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="flex items-center gap-4 mb-8">
        <button 
          onClick={() => history.back()}
          className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
          data-testid="button-back"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-xl font-bold">{isEditMode ? "Редактировать отзыв" : "Написать отзыв"}</h1>
      </header>

      <div className="mb-8">
        <h2 className="text-lg font-medium">{isEditMode ? "Обновите ваш отзыв" : "Как прошёл визит?"}</h2>
        <p className="text-sm text-muted-foreground">
          Booking #{booking.id} • {new Date(booking.appointmentTime).toLocaleDateString()}
        </p>
        {isEditable && booking.review?.editableUntil && (
          <p className="text-xs text-primary mt-2">
            Editable until: {new Date(booking.review.editableUntil).toLocaleTimeString()}
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
              onClick={() => setRating(star)}
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

        {/* Privacy Switch - placed right below stars */}
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
          <label className="text-sm font-medium ml-1">Ваш отзыв</label>
          <textarea
            required
            rows={4}
            className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
            placeholder="Расскажите о вашем опыте..."
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
            {isSubmitting || isPending ? "Сохранение..." : isEditMode ? "Обновить отзыв" : "Опубликовать"}
          </button>
        </div>
      </form>
    </div>
  );
}