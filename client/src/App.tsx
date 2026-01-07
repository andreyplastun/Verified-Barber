import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Navigation } from "@/components/Navigation";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import NotFound from "@/pages/not-found";

// Pages
import SpecialistList from "@/pages/SpecialistList";
import SpecialistProfile from "@/pages/SpecialistProfile";
import BookingPage from "@/pages/BookingPage";
import ReviewPage from "@/pages/ReviewPage";
import AdminDashboard from "@/pages/AdminDashboard";
import SpecialistDashboard from "@/pages/SpecialistDashboard";

function Router() {
  const { isSpecialist, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-background animate-pulse" />;
  }

  return (
    <Switch>
      <Route path="/" component={isSpecialist ? SpecialistDashboard : SpecialistList} />
      <Route path="/specialist-dashboard" component={SpecialistDashboard} />
      <Route path="/specialist/:id" component={SpecialistProfile} />
      <Route path="/book/:id" component={BookingPage} />
      <Route path="/review/:bookingId" component={ReviewPage} />
      <Route path="/admin" component={AdminDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Toaster />
        <Router />
        <Navigation />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
