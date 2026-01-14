import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSpecialist } from "@/hooks/use-specialists";
import { useAuth } from "@/contexts/AuthContext";
import { RatingStars } from "@/components/RatingStars";
import { ChevronLeft, Share2, ShieldCheck, MapPin, Calendar, User, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import type { Booking } from "@shared/schema";

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
      label: "High", 
      color: "text-green-500 bg-green-500/10 border-green-500/20",
      description: "Rating is highly reliable"
    };
    if (count >= 3) return { 
      label: "Medium", 
      color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      description: "Rating is stabilizing as more visits are completed"
    };
    return { 
      label: "Low", 
      color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
      description: "Based on a small number of verified visits"
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
                {confidence.label} Confidence
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold">Based on {reviewCount} verified visits</p>
            <p className="text-[11px] text-muted-foreground italic leading-tight">
              {confidence.description}
            </p>
            <p className="text-xs text-muted-foreground italic mt-1">
              Ratings are based only on completed appointments.
            </p>
          </div>

          <p className="mt-4 text-muted-foreground leading-relaxed text-sm">
            {specialist.bio}
          </p>

          <div className="mt-6 flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            <div className="flex-shrink-0 px-4 py-2 bg-secondary rounded-xl flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={16} className="text-primary" />
              Verified Pro
            </div>
            <div className="flex-shrink-0 px-4 py-2 bg-secondary rounded-xl flex items-center gap-2 text-sm font-medium">
              <MapPin size={16} className="text-primary" />
              Downtown
            </div>
            <div className="flex-shrink-0 px-4 py-2 bg-secondary rounded-xl flex items-center gap-2 text-sm font-medium">
              <Calendar size={16} className="text-primary" />
              Mon-Sat
            </div>
          </div>
        </motion.div>

        {/* Reviews Section */}
        <div className="mt-8 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Verified Reviews</h2>
            <Link href={`/specialist/${id}/reviews`}>
              <span className="text-sm text-primary hover:underline cursor-pointer">View all</span>
            </Link>
          </div>

          <div className="space-y-4">
            {(() => {
              // Only show finalized reviews where publishReview is true
              const publicReviews = specialist.reviews?.filter(r => r.isFinalized && r.publishReview) || [];
              
              if (publicReviews.length === 0) {
                return (
                  <div className="text-center py-8 text-muted-foreground text-sm bg-muted/20 rounded-2xl">
                    No reviews yet. Be the first!
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
                          Verified review
                        </span>
                      </div>
                    </div>
                    <RatingStars rating={review.rating} size={12} className="mb-2" />
                    <p className="text-sm text-muted-foreground" data-testid={`text-review-comment-${review.id}`}>{review.comment}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[10px] text-green-500 font-medium">
                        <ShieldCheck size={10} />
                        Verified Visit
                      </div>
                      <span className="text-[10px] text-muted-foreground italic">
                        {getOrdinal(visitNumber)} verified visit
                      </span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-xl border-t border-white/5 z-40 pb-safe">
        <div className="max-w-md mx-auto flex gap-3">
          <Link href="/" className="flex-1">
            <Button variant="outline" className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-back-home">
              Back to Home
            </Button>
          </Link>
          {eligibleBooking && (
            <Link href={`/review/${eligibleBooking.id}`} className="flex-1">
              <Button className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-leave-review">
                <Star className="mr-2 h-5 w-5" />
                Leave Review
              </Button>
            </Link>
          )}
          {!eligibleBooking && editableReview && reviewedBooking && (
            <Link href={`/review/${reviewedBooking.id}`} className="flex-1">
              <Button variant="secondary" className="w-full py-6 rounded-xl font-bold text-lg" data-testid="button-edit-review">
                <Star className="mr-2 h-5 w-5" />
                Edit Review
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
