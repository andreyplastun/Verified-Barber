import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/lib/auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function SpecialistDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    await signOut();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 pb-24">
      <div className="text-center space-y-6">
        <h1 className="text-2xl font-bold" data-testid="text-specialist-title">
          Welcome, Specialist!
        </h1>
        {user && (
          <p className="text-muted-foreground" data-testid="text-specialist-email">
            Logged in as: {user.email}
          </p>
        )}
        <Button 
          onClick={handleLogout} 
          variant="outline"
          data-testid="button-specialist-logout"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </Button>
      </div>
    </div>
  );
}
