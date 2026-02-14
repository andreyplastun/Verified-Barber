import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSpecialist } from "@/hooks/use-specialists";
import { useAuth } from "@/contexts/AuthContext";
import { RatingStars } from "@/components/RatingStars";
import { ChevronLeft, Share2, MapPin, Calendar, User, Star, Image, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { motion } from "framer-motion";
import { AnimatedRating, AnimatedStar, reviewCardVariants, FadeIn } from "@/components/ui/animations";
import type { Booking, SpecialistPhoto } from "@shared/schema";

export default function SpecialistProfile() {
  const [, params] = useRoute("/specialist/:id");
  const id = params ? parseInt(params.id) : 0;
  const { currentUser } = useAuth();
  const { data: specialist, isLoading } = useSpecialist(id, currentUser?.id);

  // Fetch user's bookings to check if they can leave a review
  const { data: myBookings = [] } = useQuery<Booking[]>({
    queryKey: ["/api/my-bookings", currentUser?.id],
    queryFn: async () => {
      if (!currentUser?.id) return [];
      const res = await fetch("/api/my-bookings", {
        headers: { "x-user-id": currentUser.id },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!currentUser?.id,
  });

  // Find a completed booking for this specialist that hasn't been reviewed yet
  const eligibleBooking = myBookings.find(
    (b) => b.specialistId === id && b.status === "completed" && !b.hasReview
  );

  // Find a booking that was already reviewed but might still be editable (within 5-min window)
  const reviewedBooking = myBookings.find(
    (b) => b.specialistId === id && b.status === "completed" && b.hasReview
  );

  // Fetch work photos
  const { data: photos = [] } = useQuery<SpecialistPhoto[]>({
    queryKey: ['/api/specialists', id, 'photos'],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${id}/photos`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: id > 0,
  });

  const workPhotos = photos.filter(p => p.photoType === 'work');


  if (isLoading || !specialist) {
    return <div className="min-h-screen bg-background animate-pulse" />;
  }

  // Check if the existing review is still editable (must be after specialist null check)
  const editableReview = specialist.reviews?.find(
    (r: any) => reviewedBooking && r.bookingId === reviewedBooking.id && !r.isFinalized && new Date() < new Date(r.editableUntil)
  );

  const rating = specialist.averageRating / 10;
  const reviewCount = specialist.reviewCount;
  const validReviewCount = (specialist as any).validReviewCount || 0;

  const getRatingStatus = (count: number) => {
    if (count >= 10) return { 
      label: "Сформированный рейтинг", 
      tooltip: "Рейтинг основан на достаточном количестве подтверждённых визитов"
    };
    return { 
      label: "Рейтинг формируется", 
      tooltip: "При увеличении количества отзывов рейтинг будет становиться точнее"
    };
  };

  const ratingStatus = getRatingStatus(validReviewCount);

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Hero Image */}
      <div className="relative h-[40vh] w-full">
        {/* specialist hero background */}
        <img 
          src={specialist.imageUrl} 
          alt={specialist.name}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        
        {/* Navigation Bar */}
        <div className="absolute top-0 left-0 right-0 p-4 pt-8 flex justify-between items-center z-10">
          <Link href="/">
            <button className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/40 transition-colors">
              <ChevronLeft size={24} />
            </button>
          </Link>
          <button className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/40 transition-colors">
            <Share2 size={20} />
          </button>
        </div>
      </div>

      {/* Content Container */}
      <div className="-mt-12 relative px-6 z-10">
        <div className="bg-card rounded-2xl p-4 shadow-sm border border-border">
          {/* Two-column layout: Left (identity) + Right (trust) */}
          <div className="flex justify-between items-start gap-4">
            {/* Left block - Identity */}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-foreground">{specialist.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{specialist.specialty}</p>
              {specialist.baseServiceName && specialist.baseServicePrice && (
                <div className="mt-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 whitespace-nowrap cursor-pointer" data-testid="text-base-service-price">
                        {specialist.baseServiceName}{'\u00A0'}—{'\u00A0'}{Number(specialist.baseServicePrice).toLocaleString('ru-RU')}{'\u00A0'}₸
                        <Info size={10} className="opacity-60" />
                      </span>
                    </PopoverTrigger>
                    <PopoverContent side="top" className="max-w-xs text-sm p-3">
                      <p>Это цена базовой услуги.<br/>Итоговая стоимость может отличаться в зависимости от выбранного набора услуг.</p>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>

            {/* Right block - Trust (pinned to top) */}
            <div className="flex-shrink-0 flex flex-col items-end text-right">
              <div className="flex items-center gap-1">
                <AnimatedStar ratingValue={specialist.averageRating}>
                  <Star size={16} className="text-yellow-400 fill-yellow-400" />
                </AnimatedStar>
                <AnimatedRating value={rating.toFixed(1)} className="text-lg font-semibold text-foreground" />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {reviewCount} {(() => {
                  const n = reviewCount % 100;
                  if (n >= 11 && n <= 19) return 'отзывов';
                  const last = n % 10;
                  if (last === 1) return 'отзыв';
                  if (last >= 2 && last <= 4) return 'отзыва';
                  return 'отзывов';
                })()}
              </p>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.3 }}
                className="mt-1.5"
              >
                <Popover>
                  <PopoverTrigger asChild>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 cursor-pointer" data-testid="link-rating-status">
                      {ratingStatus.label}
                      <Info size={10} className="opacity-60" />
                    </span>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" className="max-w-xs text-sm p-3">
                    <p>{ratingStatus.tooltip}</p>
                  </PopoverContent>
                </Popover>
              </motion.div>
            </div>
          </div>

          {/* Bio section - full width, separated */}
          {specialist.bio && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide mb-1.5">
                О мастере
              </p>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                {specialist.bio}
              </p>
            </div>
          )}

          {/* Service tags */}
          <div className="mt-4 flex gap-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <MapPin size={11} />
              Алматы
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <Calendar size={11} />
              Пн-Сб
            </div>
          </div>
        </div>

        {/* Work Photos Gallery */}
        {workPhotos.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <Image size={16} className="text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Работы</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {workPhotos.map((photo) => (
                <div 
                  key={photo.id} 
                  className="aspect-square rounded-lg overflow-hidden border border-border"
                  data-testid={`work-photo-display-${photo.id}`}
                >
                  <img
                    src={photo.photoUrl}
                    alt="Work"
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reviews Section */}
        <div className="mt-8 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Отзывы</h2>
            <Link href={`/specialist/${id}/reviews`}>
              <span className="text-sm text-muted-foreground hover:underline cursor-pointer">Все отзывы</span>
            </Link>
          </div>

          <div className="space-y-4">
            {(() => {
              // Only show finalized reviews where publishReview is true
              const publicReviews = specialist.reviews?.filter(r => r.isFinalized && r.publishReview) || [];
              
              if (publicReviews.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground text-sm bg-muted rounded-xl">
                    Пока нет отзывов. Будьте первым!
                  </div>
                );
              }

              // Sort reviews by date to correctly identify visit number
              const sortedReviews = [...publicReviews].sort((a, b) => 
                new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
              );
              
              return publicReviews.map((review) => {
                const visitNumber = sortedReviews.findIndex(r => r.id === review.id) + 1;
                const getOrdinal = (n: number) => {
                  const s = ["th", "st", "nd", "rd"];
                  const v = n % 100;
                  return n + (s[(v - 20) % 10] || s[v] || s[0]);
                };

                const displayName = !review.showName 
                  ? "Аноним" 
                  : (review.customerName.includes('@') 
                      ? review.customerName.split('@')[0] 
                      : review.customerName);

                return (
                  <motion.div key={review.id} className="bg-card border border-border rounded-xl p-4" data-testid={`public-review-${review.id}`} custom={sortedReviews.indexOf(review)} variants={reviewCardVariants} initial="hidden" animate="visible">
                    <div className="flex justify-between mb-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-muted-foreground" />
                          <span className="font-semibold text-sm text-foreground" data-testid={`text-reviewer-name-${review.id}`}>
                            {displayName}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-1">
                          {new Date(review.createdAt || "").toLocaleDateString()}
                        </span>
                      </div>
                      <RatingStars rating={review.rating} size={12} />
                    </div>
                    {review.triggers && review.triggers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {review.triggers.map((trigger: string, idx: number) => (
                          <span 
                            key={idx}
                            className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-xs font-medium"
                            data-testid={`trigger-chip-${review.id}-${idx}`}
                          >
                            {trigger}
                          </span>
                        ))}
                      </div>
                    )}
                    {review.comment && (
                      <p className="text-sm text-muted-foreground" data-testid={`text-review-comment-${review.id}`}>{review.comment}</p>
                    )}
                  </motion.div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar - positioned above navigation (nav is h-16 + safe area) */}
      <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] bg-background/80 backdrop-blur-xl border-t border-white/5 z-40">
        <div className="max-w-md mx-auto flex flex-col gap-2">
          {eligibleBooking && (
            <Link href={`/review/${eligibleBooking.id}`}>
              <Button className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-leave-review">
                <Star className="mr-2 h-5 w-5" />
                Оставить отзыв
              </Button>
            </Link>
          )}
          {!eligibleBooking && editableReview && reviewedBooking && (
            <Link href={`/review/${reviewedBooking.id}`}>
              <Button className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-edit-review">
                <Star className="mr-2 h-5 w-5" />
                Изменить отзыв
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
