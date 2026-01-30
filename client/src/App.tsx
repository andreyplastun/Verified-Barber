import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import NotFound from "@/pages/not-found";

import SpecialistList from "@/pages/index";
import SpecialistProfile from "@/pages/SpecialistProfile";
import SpecialistReviews from "@/pages/SpecialistReviews";
import BookingPage from "@/pages/BookingPage";
import ReviewPage from "@/pages/ReviewPage";
import MagicReviewPage from "@/pages/MagicReviewPage";
import AdminDashboard from "@/pages/AdminDashboard";
import SpecialistDashboard from "@/pages/SpecialistDashboard";
import SpecialistOnboarding from "@/pages/SpecialistOnboarding";
import LoginPage from "@/pages/LoginPage";
import { Navigation } from "@/components/Navigation";

function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground">Loading...</div>;
  }

  if (user) {
    return <Redirect to="/" />;
  }

  return <LoginPage />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground">Loading...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function AdminProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, currentUser, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground">Loading...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (currentUser?.role !== 'admin') {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function HomeRoute() {
  const { currentUser, user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground">Loading...</div>;
  }

  if (!currentUser) {
    return <Redirect to="/login" />;
  }

  if (currentUser?.role === 'admin') {
    return <Redirect to="/admin-dashboard" />;
  }

  if (currentUser?.role === 'specialist') {
    if (!user?.onboardingCompleted) {
      return <Redirect to="/specialist-onboarding" />;
    }
    return <Redirect to="/specialist-dashboard" />;
  }

  return <SpecialistList />;
}

function SpecialistDashboardRoute() {
  const { user, loading } = useAuth();

  console.log("[DASHBOARD ROUTE]", { user, loading, onboardingCompleted: user?.onboardingCompleted });

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground">Loading...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (user.role === 'specialist' && !user.onboardingCompleted) {
    console.log("[DASHBOARD ROUTE] Redirecting to onboarding because onboardingCompleted =", user.onboardingCompleted);
    return <Redirect to="/specialist-onboarding" />;
  }

  return <SpecialistDashboard />;
}

function SpecialistOnboardingRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-foreground">Loading...</div>;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (user.role !== 'specialist') {
    return <Redirect to="/" />;
  }

  if (user.onboardingCompleted) {
    return <Redirect to="/specialist-dashboard" />;
  }

  return <SpecialistOnboarding />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginRoute} />
      <Route path="/signup" component={LoginRoute} />
      <Route path="/" component={HomeRoute} />
      <Route path="/specialist/:id" component={SpecialistProfile} />
      <Route path="/book/:id">
        <ProtectedRoute>
          <BookingPage />
        </ProtectedRoute>
      </Route>
      <Route path="/review/:bookingId">
        <ProtectedRoute>
          <ReviewPage />
        </ProtectedRoute>
      </Route>
      <Route path="/r/:token" component={MagicReviewPage} />
      <Route path="/reviews" component={ReviewPage} />
      <Route path="/specialist/:id/reviews" component={SpecialistReviews} />
      <Route path="/specialists/:id/reviews" component={SpecialistReviews} />
      <Route path="/admin">
        <AdminProtectedRoute>
          <AdminDashboard />
        </AdminProtectedRoute>
      </Route>
      <Route path="/admin-dashboard">
        <AdminProtectedRoute>
          <AdminDashboard />
        </AdminProtectedRoute>
      </Route>
      <Route path="/specialist-dashboard" component={SpecialistDashboardRoute} />
      <Route path="/specialist-onboarding" component={SpecialistOnboardingRoute} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <div className="min-h-screen bg-background">
            <Router />
            <Navigation />
          </div>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
