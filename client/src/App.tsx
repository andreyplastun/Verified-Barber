import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
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
import SpecialistSignup from "@/pages/SpecialistSignup";
import LoginPage from "@/pages/LoginPage";
import PrivacyPage from "@/pages/PrivacyPage";
import TermsPage from "@/pages/TermsPage";
import OfferPage from "@/pages/OfferPage";
import HowTrustWorksPage from "@/pages/HowTrustWorksPage";
import JoinPage from "@/pages/JoinPage";
import ClaimProfilePage from "@/pages/ClaimProfilePage";
import { Navigation } from "@/components/Navigation";
import { InstallBanner } from "@/components/InstallBanner";
import { useOnboardingSeen } from "@/hooks/useOnboardingSeen";

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
      <Route path="/specialist-signup" component={SpecialistSignup} />
      <Route path="/join" component={JoinPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/offer" component={OfferPage} />
      <Route path="/how-trust-works" component={HowTrustWorksPage} />
      <Route path="/claim/:token" component={ClaimProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const [location] = useLocation();
  const { user } = useAuth();
  const hideNavigation = location.startsWith('/r/') || location.startsWith('/claim/') || location.startsWith('/review/');
  const isCriticalFlow = location.startsWith('/r/') || location.startsWith('/review/') || location.startsWith('/book/') || location.startsWith('/claim/');
  const hideInstallBanner = isCriticalFlow || location === '/auth' || location === '/join' || !user;

  const onboardingType = user?.role === "specialist" ? "pro" : "client";
  const { seen: onboardingSeen, markSeen: markOnboardingSeen } = useOnboardingSeen(onboardingType);

  const shouldShowOnboarding = !isCriticalFlow && onboardingSeen === false;

  return (
    <div className="min-h-screen bg-background">
      <Router />
      {!hideNavigation && <Navigation />}
      {!hideInstallBanner && <InstallBanner />}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
