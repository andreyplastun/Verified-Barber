import { useBookings, useCompleteBooking } from "@/hooks/use-specialists";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { CheckCircle, Clock, CalendarDays, ExternalLink, ShieldCheck } from "lucide-react";

export default function AdminDashboard() {
  const { data: bookings, isLoading } = useBookings();
  const { mutate: completeBooking, isPending } = useCompleteBooking();
  const { toast } = useToast();

  const handleComplete = (id: number) => {
    completeBooking(id, {
      onSuccess: () => {
        toast({
          title: "Booking Completed",
          description: "This visit is now verified. Review can be submitted.",
        });
      }
    });
  };

  if (isLoading) return <div className="p-6 animate-pulse">Loading dashboard...</div>;

  return (
    <div className="min-h-screen bg-background p-6 pb-24">
      <header className="mb-8">
        <h1 className="text-2xl font-display font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">Manage bookings and verify visits.</p>
      </header>

      <div className="space-y-4">
        {bookings?.map((booking) => (
          <div 
            key={booking.id} 
            className="bg-card border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row justify-between sm:items-center gap-4"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-lg">#{booking.id}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  booking.status === 'completed' 
                    ? 'bg-green-500/20 text-green-500' 
                    : 'bg-yellow-500/20 text-yellow-500'
                }`}>
                  {booking.status.toUpperCase()}
                </span>
              </div>
              <p className="font-medium text-foreground">{booking.customerName}</p>
              <p className="text-xs text-muted-foreground">{booking.customerPhone}</p>
              <div className="flex items-center text-xs text-muted-foreground mt-1">
                <CalendarDays size={12} className="mr-1" />
                {new Date(booking.appointmentTime).toLocaleDateString()}
                <Clock size={12} className="ml-2 mr-1" />
                {new Date(booking.appointmentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {booking.status !== "completed" ? (
                <button
                  onClick={() => handleComplete(booking.id)}
                  disabled={isPending}
                  className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  <ShieldCheck size={16} />
                  Verify Visit
                </button>
              ) : (
                <div className="flex items-center text-green-500 font-medium text-sm gap-1">
                  <CheckCircle size={16} />
                  Verified
                </div>
              )}
              
              <Link href={`/review/${booking.id}`}>
                <button className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
                  <ExternalLink size={16} />
                  Review Link
                </button>
              </Link>
            </div>
          </div>
        ))}

        {bookings?.length === 0 && (
          <div className="text-center py-20 text-muted-foreground border border-dashed border-white/10 rounded-3xl">
            No bookings found.
          </div>
        )}
      </div>
    </div>
  );
}
