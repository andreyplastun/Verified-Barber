import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  getCurrentUser,
  getCurrentUserWithRole,
  onAuthStateChange,
  forceLogout,
} from "@/lib/auth";
import { type AppUser, type UserRole } from "@/lib/users";

interface CurrentUser {
  id: string;
  email: string;
  role: "client" | "specialist" | "admin";
  specialistId: number | null;
}

interface AuthContextType {
  currentUser: CurrentUser | null;
  user: AppUser | null;
  authUser: any;
  loading: boolean;
  isLoading: boolean;
  isSpecialist: boolean;
  role: UserRole;
  refreshUser: () => Promise<AppUser | null>;
  refetchUser: () => Promise<AppUser | null>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  user: null,
  authUser: null,
  loading: true,
  isLoading: true,
  isSpecialist: false,
  role: "client",
  refreshUser: async () => null,
  refetchUser: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<any>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoadingState, setIsLoading] = useState(true);

  const fetchUserWithRole = async () => {
    const userWithRole = await getCurrentUserWithRole();
    if (userWithRole) {
      setUser({
        id: userWithRole.id,
        email: userWithRole.email,
        role: userWithRole.role,
        specialistId: userWithRole.specialistId ?? null,
        onboardingCompleted: userWithRole.onboardingCompleted ?? false,
        onboardingSeenClient: userWithRole.onboardingSeenClient ?? false,
        onboardingSeenPro: userWithRole.onboardingSeenPro ?? false,
        onboardingPath: userWithRole.onboardingPath ?? null,
        onboardingPathChosenAt: userWithRole.onboardingPathChosenAt ?? null,
        createdAt: userWithRole.createdAt ?? "",
      });
      return userWithRole;
    } else {
      setUser(null);
      return null;
    }
  };

  const refetchUser = useCallback(async () => {
    const userWithRole = await getCurrentUserWithRole();
    if (userWithRole) {
      const userData = {
        id: userWithRole.id,
        email: userWithRole.email,
        role: userWithRole.role,
        specialistId: userWithRole.specialistId ?? null,
        onboardingCompleted: userWithRole.onboardingCompleted ?? false,
        onboardingSeenClient: userWithRole.onboardingSeenClient ?? false,
        onboardingSeenPro: userWithRole.onboardingSeenPro ?? false,
        onboardingPath: userWithRole.onboardingPath ?? null,
        onboardingPathChosenAt: userWithRole.onboardingPathChosenAt ?? null,
        createdAt: userWithRole.createdAt ?? "",
      };
      setUser(userData);
      return userData;
    }
    return null;
  }, []);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setAuthUser(u);
      fetchUserWithRole().then(() => setIsLoading(false));
    });

    const {
      data: { subscription },
    } = onAuthStateChange((u) => {
      setAuthUser(u);
      if (u) {
        fetchUserWithRole().then(() => setIsLoading(false));
      } else {
        setUser(null);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const isSpecialist = user?.role === "specialist";
  const role = user?.role || "client";
  const isLoading = isLoadingState;
  const loading = isLoadingState;

  const currentUser: CurrentUser | null = user
    ? {
        id: user.id,
        email: user.email,
        role: user.role,
        specialistId: user.specialistId ?? null,
      }
    : null;
  console.log("AUTH DEBUG:", { user, role, loading });
  
  if (user) {
    console.log("AUTO-BIND CHECK", { id: user.id, role: user.role, specialistId: user.specialistId });
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        user,
        authUser,
        loading,
        isLoading,
        isSpecialist,
        role,
        refreshUser: refetchUser,
        refetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
