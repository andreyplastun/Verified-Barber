import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getCurrentUser, getCurrentUserWithRole, onAuthStateChange } from '@/lib/auth';
import { type AppUser, type UserRole } from '@/lib/users';

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

  const fetchUserWithRole = async () => {
    const userWithRole = await getCurrentUserWithRole();
    if (userWithRole) {
      setUser({
        id: userWithRole.id,
        email: userWithRole.email,
        role: userWithRole.role,
        specialistId: null,
        createdAt: '',
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
      setUser({
        id: userWithRole.id,
        email: userWithRole.email,
        role: userWithRole.role,
        specialistId: null,
        createdAt: '',
      });
      return {
        id: userWithRole.id,
        email: userWithRole.email,
        role: userWithRole.role,
        specialistId: null,
        createdAt: '',
      };
    }
    return null;
  }, []);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setAuthUser(u);
      fetchUserWithRole().then(() => setIsLoading(false));
    });

    const { data: { subscription } } = onAuthStateChange((u) => {
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
