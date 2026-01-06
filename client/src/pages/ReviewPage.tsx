import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useCreateReview } from "@/hooks/use-specialists";
import { useQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { Star, ChevronLeft, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ReviewPage() {
  const [, params] = useRoute("/review/:bookingId");
  const [, setLocation] = useLocation();
  
  // Parse query params for auto mode
  const queryParams = new URLSearchParams(window.location.search);
  const specialistIdFromQuery = queryParams.get("specialistId");

  const { data: booking, isLoading: isLoadingBooking, error: bookingError } = useQuery({
    queryKey: [api.bookings.list.path, params?.bookingId, specialistIdFromQuery],
    queryFn: async () => {
      // If we have a specific bookingId (not "auto"), first check if it's already reviewed
      // and if that review is editable.
      const bookingIdStr = params?.bookingId;
      
      if (bookingIdStr && bookingIdStr !== "auto") {
        const bId = parseInt(bookingIdStr);
        const url = buildUrl(api.bookings.get.path, { id: bId });
        const res = await fetch(url);
        if (res.ok) {
          const b = await res.json();
          // If it has a review, we need the review data to see if it's editable
          if (b.hasReview) {
            const rRes = await fetch(`${api.reviews.list.path}?specialistId=${b.specialistId}`);
            if (rRes.ok) {
              const reviews = await rRes.json();
              const review = reviews.find((r: any) => r.bookingId === bId);
              if (review) {
                return { ...b, review };
              }
            }
          }
          return b;
        }
      }

      if (params?.bookingId === "auto" && specialistIdFromQuery) {
        // Fetch all bookings and find the first completed one for this specialist without a review
        const res = await fetch(api.bookings.list.path);
        if (!res.ok) throw new Error("Failed to fetch bookings");
        const allBookings = await res.json();
        const autoBooking = allBookings.find((b: any) => 
          b.specialistId === parseInt(specialistIdFromQuery) && 
          b.status === "completed" && 
          !b.hasReview
        );
        if (!autoBooking) throw new Error("No completed visits found to review");
        return autoBooking;
      }

      return null;
    },
    enabled: !!params?.bookingId,
    staleTime: 0
  });

  const { toast } = useToast();
  const { mutate: createReview, isPending } = useCreateReview();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [hoveredStar, setHoveredStar] = useState(0);
  const [isEditing, setIsEditing] = useState(false);

  // Initialize form if editing existing review
  useEffect(() => {
    if (booking?.review && !isEditing) {
      setRating(booking.review.rating);
      setComment(booking.review.comment);
      setIsEditing(true);
    }
  }, [booking]);

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

    if (booking.review) {
      // Update existing review
      fetch(`/api/reviews/${booking.review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment }),
      }).then(async (res) => {
        if (res.ok) {
          toast({ title: "Review Updated", description: "Your changes have been saved." });
          setLocation(`/specialist/${booking.specialistId}`);
        } else {
          const err = await res.json();
          toast({ variant: "destructive", title: "Error", description: err.message });
        }
      });
    } else {
      // Create new review
      createReview({
        bookingId: booking.id,
        specialistId: booking.specialistId,
        rating,
        comment,
      }, {
        onSuccess: () => {
          toast({
            title: "Draft Saved",
            description: "Your review is saved. You can edit it for 2 hours before it becomes public.",
          });
          setLocation(`/specialist/${booking.specialistId}`);
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Error", description: err.message });
        }
      });
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

  if (isLoadingBooking) return <div className="p-6 text-center animate-pulse">Checking for completed visits...</div>;
  
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
        >
          Back Home
        </button>
      </div>
    );
  }

  if (booking.hasReview && !booking.review) {
    return <div className="p-6 text-center">Loading your existing review...</div>;
  }

  const isEditable = !booking.review || (!booking.review.isFinalized && new Date() < new Date(booking.review.editableUntil));

  if (booking.review && !isEditable) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center text-center">
         <h1 className="text-2xl font-bold mb-2">Review Finalized</h1>
         <p className="text-muted-foreground mb-8">This review can no longer be edited as it has been finalized or the editing window has expired.</p>
         <button 
          onClick={() => setLocation(`/specialist/${booking.specialistId}`)}
          className="px-6 py-3 bg-secondary rounded-xl font-medium"
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
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-xl font-bold">{booking.review ? "Edit Review" : "Write a Review"}</h1>
      </header>

      <div className="mb-8">
        <h2 className="text-lg font-medium">{booking.review ? "Update your feedback" : "How was your visit?"}</h2>
        <p className="text-sm text-muted-foreground">
          Booking #{booking.id} • {new Date(booking.appointmentTime).toLocaleDateString()}
        </p>
        {!booking.review?.isFinalized && booking.review?.editableUntil && (
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

        <div className="space-y-3">
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPending ? "Saving..." : booking.review ? "Update Review" : "Save Draft Review"}
          </button>
          
          {booking.review && !booking.review.isFinalized && (
            <button
              type="button"
              onClick={async () => {
                const res = await fetch(`/api/reviews/${booking.review.id}/finalize`, { method: "POST" });
                if (res.ok) {
                  toast({ title: "Review Finalized", description: "Your review is now public and rating updated." });
                  setLocation(`/specialist/${booking.specialistId}`);
                }
              }}
              className="w-full py-3 rounded-xl bg-green-500 text-white font-bold text-sm hover:bg-green-600 transition-all"
            >
              Finalize & Publish Now
            </button>
          )}
        </div>
      </form>
    </div>
  );
}