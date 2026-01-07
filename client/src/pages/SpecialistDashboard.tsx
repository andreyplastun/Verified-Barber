import { useAuth } from "@/contexts/AuthContext";

export default function SpecialistDashboard() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 pb-24">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold" data-testid="text-specialist-title">
          You are a specialist
        </h1>
        {user && (
          <p className="text-muted-foreground" data-testid="text-specialist-email">
            Logged in as: {user.email}
          </p>
        )}
      </div>
    </div>
  );
}
