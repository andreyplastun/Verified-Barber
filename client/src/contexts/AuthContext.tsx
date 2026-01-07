import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { getCurrentUser, onAuthStateChange } from '@/lib/auth';
import { getAppUser, type AppUser, type UserRole } from '@/lib/users';

interface AuthContextType {
  user: AppUser | null;
  authUser: any;
  isLoading: boolean;
  isSpecialist: boolean;
  role: UserRole;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  authUser: null,
  isLoading: true,
  isSpecialist: false,
  role: 'client',
  refetchUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<any>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = async (authUsr: any) => {
    if (authUsr) {
      const appUser = await getAppUser(authUsr.id);
      setUser(appUser);
    } else {
      setUser(null);
    }
    setIsLoading(false);
  };

  const refetchUser = async () => {
    if (authUser) {
      const appUser = await getAppUser(authUser.id);
      setUser(appUser);
    }
  };

  useEffect(() => {
    getCurrentUser().then((u) => {
      setAuthUser(u);
      fetchUser(u);
    });

    const { data: { subscription } } = onAuthStateChange((u) => {
      setAuthUser(u);
      fetchUser(u);
    });

    return () => subscription.unsubscribe();
  }, []);

  const isSpecialist = user?.role === 'specialist';
  const role = user?.role || 'client';

  return (
    <AuthContext.Provider value={{ user, authUser, isLoading, isSpecialist, role, refetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
