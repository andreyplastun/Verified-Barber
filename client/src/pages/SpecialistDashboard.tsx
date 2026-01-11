import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, Calendar, MessageSquare, User } from 'lucide-react';
import { format } from 'date-fns';
import type { Specialist, Booking, Review } from '@shared/schema';

export default function SpecialistDashboard() {
  const { currentUser } = useAuth();
  const specialistId = currentUser?.specialistId;

  const { data: specialist, isLoading: loadingSpecialist } = useQuery<Specialist>({
    queryKey: ['/api/specialists', specialistId],
    enabled: !!specialistId,
  });

  const { data: bookings, isLoading: loadingBookings } = useQuery<Booking[]>({
    queryKey: ['/api/specialists', specialistId, 'bookings'],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${specialistId}/bookings`);
      if (!res.ok) throw new Error('Failed to fetch bookings');
      return res.json();
    },
    enabled: !!specialistId,
  });

  const { data: reviews, isLoading: loadingReviews } = useQuery<Review[]>({
    queryKey: ['/api/reviews', specialistId],
    queryFn: async () => {
      const res = await fetch(`/api/reviews?specialistId=${specialistId}`);
      if (!res.ok) throw new Error('Failed to fetch reviews');
      return res.json();
    },
    enabled: !!specialistId,
  });

  if (!specialistId) {
    return (
      <div className="p-6" data-testid="specialist-dashboard">
        <p className="text-muted-foreground">No specialist profile linked to your account.</p>
      </div>
    );
  }

  const upcomingBookings = bookings?.filter(b => 
    b.status === 'pending' && new Date(b.appointmentTime) >= new Date()
  ) || [];

  const completedBookings = bookings?.filter(b => b.status === 'completed') || [];

  const averageRating = specialist?.averageRating ? (specialist.averageRating / 10).toFixed(1) : '0.0';

  return (
    <div className="p-6 space-y-6" data-testid="specialist-dashboard">
      {loadingSpecialist ? (
        <Skeleton className="h-32 w-full" />
      ) : specialist ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <img 
              src={specialist.imageUrl} 
              alt={specialist.name}
              className="w-20 h-20 rounded-full object-cover"
              data-testid="img-specialist-avatar"
            />
            <div className="flex-1">
              <CardTitle className="text-2xl" data-testid="text-specialist-name">{specialist.name}</CardTitle>
              <p className="text-muted-foreground" data-testid="text-specialty">{specialist.specialty}</p>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <span data-testid="text-rating">{averageRating}</span>
                </div>
                <Badge variant="secondary" data-testid="badge-review-count">
                  {specialist.reviewCount || 0} reviews
                </Badge>
              </div>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Calendar className="w-5 h-5" />
            <CardTitle>Upcoming Appointments</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingBookings ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : upcomingBookings.length === 0 ? (
              <p className="text-muted-foreground text-sm">No upcoming appointments</p>
            ) : (
              <div className="space-y-3">
                {upcomingBookings.map((booking) => (
                  <div 
                    key={booking.id} 
                    className="p-3 rounded-md bg-muted/50 flex items-center justify-between gap-2"
                    data-testid={`booking-item-${booking.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span data-testid={`text-customer-${booking.id}`}>{booking.customerName}</span>
                    </div>
                    <Badge variant="outline" data-testid={`badge-time-${booking.id}`}>
                      {format(new Date(booking.appointmentTime), 'MMM d, h:mm a')}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            <CardTitle>Recent Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingReviews ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : !reviews || reviews.length === 0 ? (
              <p className="text-muted-foreground text-sm">No reviews yet</p>
            ) : (
              <div className="space-y-3">
                {reviews.slice(0, 5).map((review) => {
                  // Simple privacy: if hiddenName is true, show "Анонимно"
                  const displayName = review.hiddenName 
                    ? 'Анонимно'
                    : (review.customerName.includes('@') 
                        ? review.customerName.split('@')[0] 
                        : review.customerName);
                  
                  return (
                    <div 
                      key={review.id} 
                      className="p-3 rounded-md bg-muted/50"
                      data-testid={`review-item-${review.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm" data-testid={`text-reviewer-${review.id}`}>
                            {displayName}
                          </span>
                          {review.hiddenName && (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              Анонимно
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                          <span className="text-sm" data-testid={`text-review-rating-${review.id}`}>
                            {review.rating}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground" data-testid={`text-review-comment-${review.id}`}>
                        {review.comment}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Completed Visits</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingBookings ? (
            <Skeleton className="h-16 w-full" />
          ) : completedBookings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No completed visits yet</p>
          ) : (
            <div className="space-y-2">
              {completedBookings.slice(0, 10).map((booking) => (
                <div 
                  key={booking.id}
                  className="p-3 rounded-md bg-muted/50 flex items-center justify-between gap-2"
                  data-testid={`completed-booking-${booking.id}`}
                >
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>{booking.customerName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {format(new Date(booking.appointmentTime), 'MMM d')}
                    </Badge>
                    {booking.hasReview && (
                      <Badge variant="outline" className="text-green-600">
                        Reviewed
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
