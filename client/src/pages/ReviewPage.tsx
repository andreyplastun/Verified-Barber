import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useCreateReview } from "@/hooks/use-specialists";
import { useQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { Star, ChevronLeft, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ReviewPage() {
  // We expect ?bookingId=123 query param or we can parse from URL if designed that way.
  // Implementation note says "Takes a Booking ID". Let's use a simple input if not provided, or query param.
  // Actually, easiest flow: /review/:bookingId
  const [, params] = useRoute("/review/:bookingId");
  const [, setLocation] = useLocation();
  const bookingId = params ? parseInt(params.bookingId) : 0;
  
  const { toast } = useToast();
  const { mutate: createReview, isPending } = useCreateReview();

  // Fetch booking details to verify and show info
  const { data: booking, isLoading: isLoadingBooking, error: bookingError } = useQuery({
    queryKey: [api.bookings.get.path, bookingId],
    queryFn: async () => {
      if (!bookingId) return null;
      const url = buildUrl(api.bookings.get.path, { id: bookingId });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Booking not found");
      return await res.json();
    },
    enabled: !!bookingId
  });

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [hoveredStar, setHoveredStar] = useState(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking) return;

    if (rating === 0) {
      toast({
        variant: "destructive",
        title: "Rating required",
        description: "Please select a star rating.",
      });
      return;
    }

    createReview({
      bookingId: booking.id,
      specialistId: booking.specialistId,
      rating,
      comment,
    }, {
      onSuccess: () => {
        toast({
          title: "Review Submitted",
          description: "Thank you for your feedback!",
        });
        setLocation(`/specialist/${booking.specialistId}`);
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Error",
          description: err.message,
        });
      }
    });
  };

  if (!bookingId) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto w-12 h-12 text-destructive mb-4" />
        <h2 className="text-xl font-bold">Invalid Link</h2>
        <p className="text-muted-foreground">Booking ID is missing.</p>
      </div>
    );
  }

  if (isLoadingBooking) return <div className="p-6 text-center animate-pulse">Loading booking details...</div>;
  
  if (bookingError || !booking) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="mx-auto w-12 h-12 text-destructive mb-4" />
        <h2 className="text-xl font-bold">Booking Not Found</h2>
        <p className="text-muted-foreground">We couldn't find a booking with ID #{bookingId}</p>
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
        >
          Back Home
        </button>
      </div>
    );
  }

  if (booking.hasReview) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
         <h1 className="text-2xl font-bold mb-2">Already Reviewed</h1>
         <p className="text-muted-foreground mb-8">You have already submitted a review for this visit.</p>
         <button 
          onClick={() => setLocation(`/specialist/${booking.specialistId}`)}
          className="px-6 py-3 bg-secondary rounded-xl font-medium"
        >
          View Profile
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <header className="flex items-center gap-4 mb-8">
        <button 
          onClick={() => history.back()}
          className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center hover:bg-secondary/80"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-xl font-bold">Write a Review</h1>
      </header>

      <div className="mb-8">
        <h2 className="text-lg font-medium">How was your visit?</h2>
        <p className="text-sm text-muted-foreground">
          Booking #{booking.id} • {new Date(booking.appointmentTime).toLocaleDateString()}
        </p>
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

        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Your Feedback</label>
          <textarea
            required
            rows={4}
            className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
            placeholder="Tell us about your experience..."
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isPending ? "Submitting..." : "Submit Verified Review"}
        </button>
      </form>
    </div>
  );
}
