import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, registerApiHandlers, setCsrfToken } from '@/lib/apiClient';
import type { User } from '@/lib/types';
import { fetchSession, logoutSession } from './authApi';

interface AuthContextValue {
  user: User | null;
  expiresAt: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  refreshSession: () => Promise<User | null>;
  clearAuth: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const clearAuth = useCallback(() => {
    setCsrfToken(null);
    setUser(null);
    setExpiresAt(null);
  }, []);

  const refreshSession = useCallback(async (): Promise<User | null> => {
    try {
      const session = await fetchSession();
      setUser(session.user);
      setExpiresAt(session.expiresAt);
      return session.user;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearAuth();
        return null;
      }
      clearAuth();
      return null;
    } finally {
      setLoading(false);
    }
  }, [clearAuth]);

  const logout = useCallback(async () => {
    try {
      await logoutSession();
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  useEffect(() => {
    registerApiHandlers({
      onUnauthorized: clearAuth,
      onCsrfInvalid: async () => {
        try {
          const session = await fetchSession();
          setUser(session.user);
          setExpiresAt(session.expiresAt);
          return session.csrfToken;
        } catch {
          clearAuth();
          return null;
        }
      },
    });
  }, [clearAuth]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      expiresAt,
      loading,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'ADMIN',
      refreshSession,
      clearAuth,
      logout,
    }),
    [user, expiresAt, loading, refreshSession, clearAuth, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
