import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useSpecialist, useCreateBooking } from "@/hooks/use-specialists";
import { ChevronLeft, Calendar, Clock, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { z } from "zod";

export default function BookingPage() {
  const [, params] = useRoute("/book/:id");
  const [, setLocation] = useLocation();
  const id = params ? parseInt(params.id) : 0;
  
  const { data: specialist, isLoading } = useSpecialist(id);
  const { mutate: createBooking, isPending } = useCreateBooking();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    date: "",
    time: "",
  });

  const [bookingSuccess, setBookingSuccess] = useState<number | null>(null);

  if (isLoading || !specialist) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Combine date and time
    const appointmentTime = new Date(`${formData.date}T${formData.time}`);
    
    createBooking({
      specialistId: id,
      customerName: formData.name,
      customerPhone: formData.phone,
      appointmentTime: appointmentTime.toISOString(),
    }, {
      onSuccess: (data) => {
        setBookingSuccess(data.id);
        toast({
          title: "Booking Confirmed!",
          description: "We've sent the details to your phone.",
        });
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Booking Failed",
          description: err.message,
        });
      }
    });
  };

  if (bookingSuccess) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center animate-in">
        <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        </div>
        <h1 className="text-3xl font-display font-bold mb-2">You're Booked!</h1>
        <p className="text-muted-foreground mb-8">
          Your appointment with {specialist.name} is confirmed.
        </p>
        
        <div className="bg-card border border-white/5 p-6 rounded-2xl w-full max-w-sm mb-8">
          <div className="text-sm text-muted-foreground uppercase tracking-wider mb-1">Booking ID</div>
          <div className="text-3xl font-mono font-bold text-primary tracking-widest">#{bookingSuccess}</div>
          <div className="my-4 border-t border-dashed border-white/10" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Date</span>
            <span className="font-medium">{format(new Date(formData.date), 'MMMM do, yyyy')}</span>
          </div>
          <div className="flex justify-between text-sm mt-2">
            <span className="text-muted-foreground">Time</span>
            <span className="font-medium">{formData.time}</span>
          </div>
        </div>

        <div className="space-y-4 w-full max-w-sm">
          <button 
            onClick={() => setLocation("/")}
            className="w-full py-3 bg-secondary rounded-xl font-medium hover:bg-secondary/80 transition-colors"
          >
            Back to Home
          </button>
          
          <div className="text-xs text-muted-foreground">
            For demo purposes: Go to Admin to complete this booking so you can leave a review.
          </div>
        </div>
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
        <div>
          <h1 className="text-xl font-bold">Book Appointment</h1>
          <p className="text-sm text-muted-foreground">with {specialist.name}</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-md mx-auto">
        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Your Name</label>
          <input
            required
            className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            placeholder="John Doe"
            value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium ml-1">Phone Number</label>
          <input
            required
            type="tel"
            className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            placeholder="+1 (555) 000-0000"
            value={formData.phone}
            onChange={e => setFormData({...formData, phone: e.target.value})}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium ml-1 flex items-center gap-2">
              <Calendar size={14} /> Date
            </label>
            <input
              required
              type="date"
              className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-sm"
              value={formData.date}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setFormData({...formData, date: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium ml-1 flex items-center gap-2">
              <Clock size={14} /> Time
            </label>
            <input
              required
              type="time"
              className="w-full bg-card border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all text-sm"
              value={formData.time}
              onChange={e => setFormData({...formData, time: e.target.value})}
            />
          </div>
        </div>

        <div className="pt-8">
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPending ? "Confirming..." : "Confirm Booking"}
          </button>
          <p className="text-center text-xs text-muted-foreground mt-4">
            No payment required today. Pay at the venue.
          </p>
        </div>
      </form>
    </div>
  );
}
