import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSpecialist } from "@/hooks/use-specialists";
import { RatingStars } from "@/components/RatingStars";
import { ChevronLeft, User, ShieldCheck } from "lucide-react";
import type { Review } from "@shared/schema";

export default function SpecialistReviews() {
  const [, params] = useRoute("/specialist/:id/reviews");
  const id = params ? parseInt(params.id) : 0;

  // Use the same hook as SpecialistProfile for consistency
  const { data: specialist, isLoading: loadingSpecialist } = useSpecialist(id);

  // Fetch reviews - need custom queryFn since default joins queryKey as URL path
  const { data: reviews = [], isLoading: loadingReviews } = useQuery<Review[]>({
    queryKey: ["/api/reviews", "specialistId", id],
    queryFn: async () => {
      const res = await fetch(`/api/reviews?specialistId=${id}`, {
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json();
    },
    enabled: !!id,
  });

  const isLoading = loadingSpecialist || loadingReviews;

  if (isLoading) {
    return <div className="min-h-screen bg-background animate-pulse" />;
  }

  const publicReviews = reviews.filter(r => r.isFinalized && r.publishReview);
  const sortedReviews = [...publicReviews].sort((a, b) => 
    new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );

  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-white/5 p-4">
        <div className="flex items-center gap-4">
          <Link href={`/specialist/${id}`}>
            <button 
              className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
              data-testid="button-back"
            >
              <ChevronLeft size={24} />
            </button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Все отзывы</h1>
            {specialist && (
              <p className="text-sm text-muted-foreground">{specialist.name}</p>
            )}
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {publicReviews.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium mb-2">Пока нет отзывов</p>
            <p className="text-sm">Будьте первым, кто оставит отзыв после визита!</p>
          </div>
        ) : (
          publicReviews.map((review) => {
            const visitNumber = sortedReviews.findIndex(r => r.id === review.id) + 1;
            const displayName = !review.showName 
              ? "Аноним" 
              : (review.customerName.includes('@') 
                  ? review.customerName.split('@')[0] 
                  : review.customerName);

            return (
              <div 
                key={review.id} 
                className="bg-card border border-white/5 rounded-2xl p-4"
                data-testid={`review-card-${review.id}`}
              >
                <div className="flex justify-between mb-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User size={16} className="text-primary" />
                      </div>
                      <div>
                        <span className="font-semibold text-sm" data-testid={`text-reviewer-name-${review.id}`}>
                          {displayName}
                        </span>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(review.createdAt || "").toLocaleDateString('ru-RU', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <RatingStars rating={review.rating} size={14} />
                    <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[9px] font-bold border border-green-500/20">
                      Проверен
                    </span>
                  </div>
                </div>
                
                {review.triggers && review.triggers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
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
                  <p className="text-sm text-foreground leading-relaxed mb-3" data-testid={`text-review-comment-${review.id}`}>
                    {review.comment}
                  </p>
                )}
                
                <div className="flex items-center justify-between pt-2 border-t border-white/5">
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
          })
        )}
      </div>
    </div>
  );
}
