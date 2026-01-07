import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Home, ShieldCheck, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { signOut, getCurrentUserWithRole } from "@/lib/auth";
import { AuthModal } from "./auth/AuthModal";
import { queryClient } from "@/lib/queryClient";

export function Navigation() {
  const [location, setLocation] = useLocation();
  const { authUser, refetchUser } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const handleLogout = async () => {
    await signOut();
    queryClient.clear();
    setLocation("/login");
  };

  const handleLoginSuccess = async () => {
    await refetchUser();
    const userWithRole = await getCurrentUserWithRole();
    if (userWithRole?.role === 'specialist') {
      setLocation('/specialist-dashboard');
    } else {
      setLocation('/');
    }
  };

  const navItems = [
    { href: "/", icon: Home, label: "Explore" },
    { href: "/admin", icon: ShieldCheck, label: "Admin" },
  ];

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-t border-white/5 pb-safe">
        <div className="flex justify-around items-center h-16 max-w-md mx-auto px-4">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div 
                  className={cn(
                    "flex flex-col items-center justify-center space-y-1 w-16 h-full cursor-pointer transition-colors duration-200",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon 
                    className={cn(
                      "w-6 h-6 transition-transform duration-200",
                      isActive && "scale-110"
                    )} 
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}

          {authUser ? (
            <button
              onClick={handleLogout}
              className="flex flex-col items-center justify-center space-y-1 w-16 h-full cursor-pointer transition-colors duration-200 text-muted-foreground hover:text-foreground"
              data-testid="button-logout"
            >
              <LogOut className="w-6 h-6" strokeWidth={2} />
              <span className="text-[10px] font-medium">Logout</span>
            </button>
          ) : (
            <button
              onClick={() => setAuthModalOpen(true)}
              className="flex flex-col items-center justify-center space-y-1 w-16 h-full cursor-pointer transition-colors duration-200 text-muted-foreground hover:text-foreground"
              data-testid="button-login"
            >
              <LogIn className="w-6 h-6" strokeWidth={2} />
              <span className="text-[10px] font-medium">Login</span>
            </button>
          )}
        </div>
      </nav>

      <AuthModal 
        isOpen={authModalOpen} 
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleLoginSuccess}
      />
    </>
  );
}
