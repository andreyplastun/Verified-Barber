import { useRoute, Link } from "wouter";
import { useSpecialist } from "@/hooks/use-specialists";
import { RatingStars } from "@/components/RatingStars";
import { ChevronLeft, Share2, ShieldCheck, MapPin, Calendar, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export default function SpecialistProfile() {
  const [, params] = useRoute("/specialist/:id");
  const id = params ? parseInt(params.id) : 0;
  const { data: specialist, isLoading } = useSpecialist(id);

  if (isLoading || !specialist) {
    return <div className="min-h-screen bg-background animate-pulse" />;
  }

  const rating = specialist.averageRating / 10;

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
              <div className="flex items-center bg-yellow-500/10 px-2 py-1 rounded-lg border border-yellow-500/20">
                <span className="font-bold text-yellow-500 mr-1">{rating.toFixed(1)}</span>
                <RatingStars rating={rating} size={12} className="hidden sm:flex" />
              </div>
              <span className="text-xs text-muted-foreground mt-1 text-right">
                {specialist.reviewCount} reviews
              </span>
            </div>
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
            {specialist.reviews?.length ? (
              specialist.reviews
                .filter(r => r.isFinalized) // ONLY show finalized to public.
                .map((review) => (
                <div key={review.id} className="bg-card border border-white/5 rounded-2xl p-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-semibold text-sm">{review.customerName}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(review.createdAt || "").toLocaleDateString()}
                    </span>
                  </div>
                  <RatingStars rating={review.rating} size={12} className="mb-2" />
                  <p className="text-sm text-muted-foreground">{review.comment}</p>
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-green-500 font-medium">
                    <ShieldCheck size={10} />
                    Verified Visit
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm bg-muted/20 rounded-2xl">
                No reviews yet. Be the first!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-xl border-t border-white/5 z-40 pb-safe">
        <div className="max-w-md mx-auto space-y-3">
          <Link href={`/review/auto?specialistId=${specialist.id}`}>
            <button className="w-full py-3 bg-secondary rounded-xl text-sm font-bold hover-elevate transition-all">
              Write or Edit Review
            </button>
          </Link>
          <Link href={`/book/${specialist.id}`}>
            <Button className="w-full py-6 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98] transition-all">
              Book Appointment
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
