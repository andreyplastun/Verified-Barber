import { useState, useEffect, useRef } from "react";
import { trackProfileView } from "@/lib/analytics";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSpecialist } from "@/hooks/use-specialists";
import { useAuth } from "@/contexts/AuthContext";
import { RatingStars } from "@/components/RatingStars";
import { ChevronLeft, Share2, MapPin, Calendar, User, Star, Image, Info, UserCheck, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { BookingButton } from "@/components/BookingButton";
import { AnimatedRating, AnimatedStar, reviewCardVariants, FadeIn, Confetti } from "@/components/ui/animations";
import type { Booking, SpecialistPhoto } from "@shared/schema";

export default function SpecialistProfile() {
  const [, params] = useRoute("/specialist/:id");
  const id = params ? parseInt(params.id) : 0;
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data: specialist, isLoading } = useSpecialist(id, currentUser?.id);

  const { data: claimStatus } = useQuery<{ isClaimed: boolean }>({
    queryKey: ['/api/specialists', id, 'claim-status'],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${id}/claim-status`);
      if (!res.ok) return { isClaimed: true };
      return res.json();
    },
    enabled: id > 0,
  });

  const [showClaimForm, setShowClaimForm] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimPhone, setClaimPhone] = useState("");

  const dismissClaimModal = () => {
    setShowClaimModal(false);
    if (id > 0) localStorage.setItem(`claim_modal_seen_${id}`, "1");
  };

  const claimMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/claim-requests", { specialistId: id, phone: claimPhone });
    },
    onSuccess: () => {
      toast({ title: "Запрос отправлен", description: "Администратор рассмотрит ваш запрос." });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', id, 'claim-status'] });
      setShowClaimForm(false);
      setShowClaimModal(false);
      setClaimPhone("");
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error?.message || "Ошибка при отправке запроса", variant: "destructive" });
    },
  });

  const showClaimButton = claimStatus && !claimStatus.isClaimed;

  useEffect(() => {
    if (showClaimButton && id > 0 && !localStorage.getItem(`claim_modal_seen_${id}`)) {
      const t = setTimeout(() => setShowClaimModal(true), 700);
      return () => clearTimeout(t);
    }
  }, [showClaimButton, id]);

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

  const [showConfetti, setShowConfetti] = useState(false);
  const confettiTriggeredRef = useRef(false);
  const profileViewTrackedRef = useRef(false);

  useEffect(() => {
    if (specialist?.id && !profileViewTrackedRef.current) {
      profileViewTrackedRef.current = true;
      trackProfileView(specialist.id);
    }
  }, [specialist?.id]);

  useEffect(() => {
    if (
      specialist &&
      specialist.reviewCount === 1 &&
      !(specialist as any).firstReviewCelebrated &&
      !confettiTriggeredRef.current
    ) {
      confettiTriggeredRef.current = true;
      setShowConfetti(true);
      fetch(`/api/specialists/${specialist.id}/first-review-celebrated`, { method: "POST" }).catch(() => {});
      const t = setTimeout(() => setShowConfetti(false), 800);
      return () => clearTimeout(t);
    }
  }, [specialist]);

  if (isLoading || !specialist) {
    return <div className="min-h-screen bg-background animate-pulse" />;
  }

  // Check if the existing review is still editable (must be after specialist null check)
  const editableReview = specialist.reviews?.find(
    (r: any) => reviewedBooking && r.bookingId === reviewedBooking.id && !r.isFinalized && new Date() < new Date(r.editableUntil)
  );

  const trustedRating = (specialist as any).trustedRating || 0;
  const trustedReviewsCount = (specialist as any).trustedReviewsCount || 0;
  const reviewCount = specialist.reviewCount;
  const validReviewCount = (specialist as any).validReviewCount || 0;

  const isNewProfile = trustedReviewsCount < 3;
  const hasNoData = trustedRating === 0;
  const displayRating = trustedRating > 0 ? trustedRating.toFixed(1) : '0.0';

  const getRatingStatus = () => {
    if (isNewProfile) return {
      label: "Новый профиль",
      tooltip: "Рейтинг появится после 3 подтверждённых визитов"
    };
    if (validReviewCount >= 10) return { 
      label: "Сформированный рейтинг", 
      tooltip: "Рейтинг основан на достаточном количестве подтверждённых визитов"
    };
    return { 
      label: "Рейтинг формируется", 
      tooltip: "При увеличении количества отзывов рейтинг будет становиться точнее"
    };
  };

  const ratingStatus = getRatingStatus();

  return (
    <div className="min-h-screen bg-background pb-32">
      <Confetti show={showConfetti} />
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
              {isNewProfile ? (
                <span className="text-sm text-muted-foreground" data-testid="text-new-profile">Новый профиль</span>
              ) : hasNoData ? (
                <span className="text-sm text-muted-foreground" data-testid="text-no-data">Недостаточно данных</span>
              ) : (
                <>
                  <div className="flex items-center gap-1">
                    <AnimatedStar ratingValue={trustedRating}>
                      <Star size={16} className="text-yellow-400 fill-yellow-400" />
                    </AnimatedStar>
                    <AnimatedRating value={displayRating} className="text-lg font-semibold text-foreground" />
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
                </>
              )}
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
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60" data-testid="text-city">
              <MapPin size={11} />
              {(specialist as any).city || 'Алматы'}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <Calendar size={11} />
              Пн-Сб
            </div>
          </div>
          {(specialist as any).workAddress && (
            <div className="mt-2 flex items-start gap-1 text-xs text-muted-foreground/60" data-testid="text-work-address">
              <MapPin size={11} className="mt-0.5 flex-shrink-0" />
              <span>{(specialist as any).workAddress}</span>
            </div>
          )}

          {/* Booking button — after bio so user reads first, then books */}
          <div style={{ marginTop: 20 }}>
            <BookingButton specialist={specialist as any} variant="profile" />
          </div>
        </div>

        {showClaimButton && (
          <div className="mt-4 bg-card rounded-2xl p-4 shadow-sm border border-border" data-testid="claim-profile-banner">
            {!showClaimForm ? (
              <div className="flex items-center gap-3">
                <UserCheck className="w-5 h-5 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Это ваш профиль?</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Отправьте запрос на управление</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => setShowClaimForm(true)}
                  data-testid="button-claim-profile"
                >
                  Забрать
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-primary flex-shrink-0" />
                  <p className="text-sm font-medium">Укажите ваш номер телефона</p>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="tel"
                      placeholder="+7 (___) ___-__-__"
                      value={claimPhone}
                      onChange={(e) => setClaimPhone(e.target.value)}
                      className="pl-9"
                      data-testid="input-claim-phone"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => claimMutation.mutate()}
                    disabled={claimMutation.isPending || !claimPhone.trim()}
                    data-testid="button-submit-claim"
                  >
                    {claimMutation.isPending ? "..." : "Отправить"}
                  </Button>
                </div>
                <button
                  className="text-xs text-muted-foreground underline"
                  onClick={() => { setShowClaimForm(false); setClaimPhone(""); }}
                  data-testid="button-cancel-claim"
                >
                  Отмена
                </button>
              </div>
            )}
          </div>
        )}

        <Dialog open={showClaimModal} onOpenChange={(open) => { if (!open) dismissClaimModal(); }}>
          <DialogContent className="sm:max-w-sm" data-testid="modal-claim-profile">
            <DialogHeader>
              <DialogTitle>Это ваш аккаунт?</DialogTitle>
              <DialogDescription>
                Заберите свой аккаунт, чтобы управлять записями, фото и отзывами. Укажите ваш номер — администратор подтвердит, и профиль станет вашим.
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="tel"
                placeholder="+7 (___) ___-__-__"
                value={claimPhone}
                onChange={(e) => setClaimPhone(e.target.value)}
                className="pl-9"
                data-testid="input-claim-phone-modal"
              />
            </div>
            <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                onClick={dismissClaimModal}
                data-testid="button-claim-later"
              >
                Позже
              </Button>
              <Button
                onClick={() => claimMutation.mutate()}
                disabled={claimMutation.isPending || !claimPhone.trim()}
                data-testid="button-claim-account-modal"
              >
                {claimMutation.isPending ? "..." : "Забрать аккаунт"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
