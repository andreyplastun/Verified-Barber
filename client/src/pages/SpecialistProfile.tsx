import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSpecialist } from "@/hooks/use-specialists";
import { useAuth } from "@/contexts/AuthContext";
import { RatingStars } from "@/components/RatingStars";
import { ChevronLeft, Share2, ShieldCheck, MapPin, Calendar, User, Star, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
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

  const getTrustConfidence = (count: number) => {
    if (count >= 10) return { 
      label: "Высокая", 
      color: "text-green-500 bg-green-500/10 border-green-500/20",
      description: "Рейтинг надёжный"
    };
    if (count >= 3) return { 
      label: "Средняя", 
      color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      description: "Рейтинг стабилизируется с новыми визитами"
    };
    return { 
      label: "Низкая", 
      color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
      description: "Основан на небольшом числе визитов"
    };
  };

  const confidence = getTrustConfidence(reviewCount);

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
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card/80 backdrop-blur-xl border border-white/5 rounded-3xl p-6 shadow-xl"
        >
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold font-display">{specialist.name}</h1>
              <p className="text-primary font-medium">{specialist.specialty}</p>
            </div>
            <div className="flex flex-col items-end">
              <div className="flex items-center bg-primary/10 px-2 py-1 rounded-lg border border-primary/20">
                <ShieldCheck size={14} className="text-primary mr-1" />
                <span className="font-bold text-primary text-lg">{rating.toFixed(1)}</span>
              </div>
              <div className={`mt-1 px-2 py-0.5 rounded text-[10px] font-bold border ${confidence.color}`}>
                {confidence.label} достоверность
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold">На основе {reviewCount} подтверждённых визитов</p>
            <p className="text-[11px] text-muted-foreground italic leading-tight">
              {confidence.description}
            </p>
            <p className="text-xs text-muted-foreground italic mt-1">
              Рейтинг основан только на завершённых визитах.
            </p>
          </div>

          <p className="mt-4 text-muted-foreground leading-relaxed text-sm">
            {specialist.bio}
          </p>

          <div className="mt-6 flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            <div className="flex-shrink-0 px-4 py-2 bg-secondary rounded-xl flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={16} className="text-primary" />
              Проверенный
            </div>
            <div className="flex-shrink-0 px-4 py-2 bg-secondary rounded-xl flex items-center gap-2 text-sm font-medium">
              <MapPin size={16} className="text-primary" />
              Алматы
            </div>
            <div className="flex-shrink-0 px-4 py-2 bg-secondary rounded-xl flex items-center gap-2 text-sm font-medium">
              <Calendar size={16} className="text-primary" />
              Пн-Сб
            </div>
          </div>
        </motion.div>

        {/* Work Photos Gallery */}
        {workPhotos.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <Image size={18} className="text-primary" />
              <h2 className="text-lg font-bold">Работы</h2>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {workPhotos.map((photo) => (
                <div 
                  key={photo.id} 
                  className="aspect-square rounded-xl overflow-hidden border border-white/5"
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
          </motion.div>
        )}

        {/* Reviews Section */}
        <div className="mt-8 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Отзывы</h2>
            <Link href={`/specialist/${id}/reviews`}>
              <span className="text-sm text-primary hover:underline cursor-pointer">Все отзывы</span>
            </Link>
          </div>

          <div className="space-y-4">
            {(() => {
              // Only show finalized reviews where publishReview is true
              const publicReviews = specialist.reviews?.filter(r => r.isFinalized && r.publishReview) || [];
              
              if (publicReviews.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground text-sm bg-muted/20 rounded-2xl">
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
                  <div key={review.id} className="bg-card border border-white/5 rounded-2xl p-4" data-testid={`public-review-${review.id}`}>
                    <div className="flex justify-between mb-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-muted-foreground" />
                          <span className="font-semibold text-sm" data-testid={`text-reviewer-name-${review.id}`}>
                            {displayName}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground italic mt-1">
                          {new Date(review.createdAt || "").toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[9px] font-bold border border-green-500/20">
                          Проверенный отзыв
                        </span>
                      </div>
                    </div>
                    <RatingStars rating={review.rating} size={12} className="mb-2" />
                    {review.triggers && review.triggers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {review.triggers.map((trigger: string, idx: number) => (
                          <span 
                            key={idx}
                            className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
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
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[10px] text-green-500 font-medium">
                        <ShieldCheck size={10} />
                        Подтверждённый визит
                      </div>
                      <span className="text-[10px] text-muted-foreground italic">
                        Визит #{visitNumber}
                      </span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar - positioned above navigation (nav is h-16 + safe area) */}
      <div className="fixed bottom-0 left-0 right-0 p-4 pb-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] bg-background/80 backdrop-blur-xl border-t border-white/5 z-40">
        <div className="max-w-md mx-auto flex gap-3">
          <Link href="/" className="flex-1">
            <Button variant="outline" className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-back-home">
              На главную
            </Button>
          </Link>
          {eligibleBooking && (
            <Link href={`/review/${eligibleBooking.id}`} className="flex-1">
              <Button className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-leave-review">
                <Star className="mr-2 h-5 w-5" />
                Оставить отзыв
              </Button>
            </Link>
          )}
          {!eligibleBooking && editableReview && reviewedBooking && (
            <Link href={`/review/${reviewedBooking.id}`} className="flex-1">
              <Button variant="secondary" className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-edit-review">
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
