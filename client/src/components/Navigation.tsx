import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Home, ShieldCheck, LogIn, LogOut, User, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { signOut, getCurrentUserWithRole } from "@/lib/auth";
import { AuthModal } from "./auth/AuthModal";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { claimPhoneSchema } from "@shared/claim-phone";

export function Navigation() {
  const [location, setLocation] = useLocation();
  const { authUser, currentUser, refetchUser, loading } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimPhone, setClaimPhone] = useState("");
  const [claimPhoneError, setClaimPhoneError] = useState("");
  const { toast } = useToast();

  const handleLogout = async () => {
    await signOut();
    queryClient.clear();
    window.location.href = "/login";
  };

  const handleLoginSuccess = async () => {
    await refetchUser();
    const userWithRole = await getCurrentUserWithRole();
    if (userWithRole?.role === 'specialist') {
      setLocation('/specialist-dashboard');
    } else if (userWithRole?.role === 'admin') {
      setLocation('/admin-dashboard');
    } else {
      setLocation('/');
    }
  };

  const specialistMatch = location.match(/^\/specialist\/(\d+)$/);
  const specialistId = specialistMatch ? parseInt(specialistMatch[1]) : null;

  const { data: claimStatus } = useQuery<{ isClaimed: boolean }>({
    queryKey: ['/api/specialists', specialistId, 'claim-status'],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${specialistId}/claim-status`);
      if (!res.ok) return { isClaimed: true };
      return res.json();
    },
    enabled: specialistId !== null && specialistId > 0,
  });

  const claimMutation = useMutation({
    mutationFn: async (phone: string) => {
      await apiRequest("POST", "/api/claim-requests", {
        specialistId: specialistId,
        phone,
      });
    },
    onSuccess: () => {
      toast({
        title: "Запрос отправлен",
        description: "Администратор рассмотрит ваш запрос.",
      });
      setClaimModalOpen(false);
      setClaimPhone("");
      setClaimPhoneError("");
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'claim-status'] });
    },
    onError: (error: any) => {
      toast({
        title: "Ошибка",
        description: error?.message || "Ошибка при отправке запроса",
        variant: "destructive",
      });
    },
  });

  const submitClaim = () => {
    const parsed = claimPhoneSchema.safeParse(claimPhone);
    if (!parsed.success) {
      setClaimPhoneError(parsed.error.errors[0].message);
      return;
    }
    setClaimPhoneError("");
    claimMutation.mutate(parsed.data);
  };

  const showClaimButton = specialistId !== null && claimStatus && !claimStatus.isClaimed;

  const getDashboardLink = () => {
    if (currentUser?.role === 'admin') {
      return { href: "/admin-dashboard", icon: ShieldCheck, label: "Админ" };
    }
    if (currentUser?.role === 'specialist') {
      return { href: "/specialist-dashboard", icon: User, label: "Кабинет" };
    }
    return null;
  };

  const dashboardItem = getDashboardLink();

  const navItems = [
    { href: "/", icon: Home, label: "Главная" },
    ...(dashboardItem ? [dashboardItem] : []),
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

          {showClaimButton && (
            <button
              onClick={() => setClaimModalOpen(true)}
              disabled={claimMutation.isPending}
              className="flex flex-col items-center justify-center space-y-1 w-16 h-full cursor-pointer transition-colors duration-200 text-muted-foreground hover:text-foreground"
              data-testid="button-claim-profile"
            >
              <UserCheck className={cn("w-6 h-6", claimMutation.isPending && "animate-pulse")} strokeWidth={2} />
              <span className="text-[10px] font-medium leading-tight text-center">Забрать управление{'\n'}профилем</span>
            </button>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center space-y-1 w-16 h-full text-muted-foreground">
              <LogIn className="w-6 h-6 opacity-30" strokeWidth={2} />
              <span className="text-[10px] font-medium opacity-30">Войти</span>
            </div>
          ) : authUser ? (
            <button
              onClick={handleLogout}
              className="flex flex-col items-center justify-center space-y-1 w-16 h-full cursor-pointer transition-colors duration-200 text-muted-foreground hover:text-foreground"
              data-testid="button-logout"
            >
              <LogOut className="w-6 h-6" strokeWidth={2} />
              <span className="text-[10px] font-medium">Выйти</span>
            </button>
          ) : (
            <Link
              href="/login"
              className="flex flex-col items-center justify-center space-y-1 w-16 h-full cursor-pointer transition-colors duration-200 text-muted-foreground hover:text-foreground"
              data-testid="button-login"
            >
              <LogIn className="w-6 h-6" strokeWidth={2} />
              <span className="text-[10px] font-medium">Войти</span>
            </Link>
          )}
        </div>
      </nav>

      <AuthModal 
        isOpen={authModalOpen} 
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleLoginSuccess}
      />

      <Dialog
        open={claimModalOpen}
        onOpenChange={(open) => {
          setClaimModalOpen(open);
          if (!open) setClaimPhoneError("");
        }}
      >
        <DialogContent className="sm:max-w-sm" data-testid="modal-navigation-claim">
          <DialogHeader>
            <DialogTitle>Забрать управление профилем</DialogTitle>
            <DialogDescription>
              Укажите ваш номер WhatsApp. После одобрения заявки на него придёт ссылка для привязки профиля.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="navigation-claim-phone" className="text-sm font-medium">
              Номер WhatsApp
            </label>
            <Input
              id="navigation-claim-phone"
              type="tel"
              placeholder="+7 (___) ___-__-__"
              value={claimPhone}
              onChange={(event) => {
                setClaimPhone(event.target.value);
                if (claimPhoneError) setClaimPhoneError("");
              }}
              aria-invalid={Boolean(claimPhoneError)}
              data-testid="input-navigation-claim-phone"
            />
            {claimPhoneError && (
              <p className="text-sm text-destructive" role="alert">{claimPhoneError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClaimModalOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={submitClaim}
              disabled={claimMutation.isPending}
              data-testid="button-navigation-submit-claim"
            >
              {claimMutation.isPending ? "Отправляем..." : "Отправить запрос"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
