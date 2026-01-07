import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getCurrentUser, onAuthStateChange } from '@/lib/auth';
import { getAppUser, type AppUser, type UserRole } from '@/lib/users';

interface AuthContextType {
  user: AppUser | null;
  authUser: any;
  isLoading: boolean;
  isSpecialist: boolean;
  role: UserRole;
  refetchUser: () => Promise<AppUser | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  authUser: null,
  isLoading: true,
  isSpecialist: false,
  role: 'client',
  refetchUser: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<any>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = async (authUsr: any) => {
    if (authUsr) {
      const appUser = await getAppUser(authUsr.id);
      setUser(appUser);
      return appUser;
    } else {
      setUser(null);
      return null;
    }
  };

  const refetchUser = useCallback(async () => {
    if (authUser) {
      const appUser = await getAppUser(authUser.id);
      setUser(appUser);
      return appUser;
    }
    return null;
  }, [authUser]);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setAuthUser(u);
      fetchUser(u).then(() => setIsLoading(false));
    });

    const { data: { subscription } } = onAuthStateChange((u) => {
      setAuthUser(u);
      fetchUser(u).then(() => setIsLoading(false));
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
