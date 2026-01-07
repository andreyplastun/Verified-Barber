import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Navigation } from "@/components/Navigation";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import NotFound from "@/pages/not-found";

// Pages
import SpecialistList from "@/pages/index";
import SpecialistProfile from "@/pages/SpecialistProfile";
import BookingPage from "@/pages/BookingPage";
import ReviewPage from "@/pages/ReviewPage";
import AdminDashboard from "@/pages/AdminDashboard";
import SpecialistDashboard from "@/pages/SpecialistDashboard";
import LoginPage from "@/pages/LoginPage";

function Spinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  if (!currentUser) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function ProtectedSpecialistRoute() {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  if (!currentUser) {
    return <Redirect to="/login" />;
  }

  if (currentUser.role !== 'specialist') {
    return <Redirect to="/" />;
  }

  return <SpecialistDashboard />;
}

function HomeRoute() {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  if (currentUser?.role === 'specialist') {
    return <Redirect to="/specialist-dashboard" />;
  }

  return <SpecialistList />;
}

function LoginRoute() {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  if (currentUser) {
    if (currentUser.role === 'specialist') {
      return <Redirect to="/specialist-dashboard" />;
    }
    return <Redirect to="/" />;
  }

  return <LoginPage />;
}

function Router() {
  const { loading } = useAuth();

  if (loading) {
    return <Spinner />;
  }

  return (
    <Switch>
      <Route path="/login" component={LoginRoute} />
      <Route path="/signup" component={LoginRoute} />
      <Route path="/" component={HomeRoute} />
      <Route path="/specialist-dashboard" component={ProtectedSpecialistRoute} />
      <Route path="/specialist/:id">{() => <RequireAuth><SpecialistProfile /></RequireAuth>}</Route>
      <Route path="/book/:id">{() => <RequireAuth><BookingPage /></RequireAuth>}</Route>
      <Route path="/review/:bookingId">{() => <RequireAuth><ReviewPage /></RequireAuth>}</Route>
      <Route path="/admin">{() => <RequireAuth><AdminDashboard /></RequireAuth>}</Route>
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
