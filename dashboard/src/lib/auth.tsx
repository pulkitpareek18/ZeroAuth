import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken, ApiError, type Account } from './api';

interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  account: Account | null;
  error: string | null;
}

/**
 * Signup result surfaced to the UI. Under F-2 v2 (issue #27) the API never
 * returns a token or API key on signup — those land on /dashboard/signup-complete
 * after the user clicks the verification link.
 */
export interface SignupResult {
  status: 'pending_verification';
  message: string;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; password: string; companyName?: string }) => Promise<SignupResult>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    account: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setState({ status: 'unauthenticated', account: null, error: null });
      return;
    }
    try {
      const account = await api.account();
      setState({ status: 'authenticated', account, error: null });
    } catch (err) {
      // A 401 will have already cleared the token in api.ts; anything else
      // we surface as an error and treat as unauthenticated.
      const message = err instanceof ApiError ? err.message : (err as Error).message;
      setState({ status: 'unauthenticated', account: null, error: message });
    }
  }, []);

  // On mount, attempt to hydrate the session from the stored token.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    setToken(res.token);
    await refresh();
  }, [refresh]);

  const signup = useCallback(async (input: { email: string; password: string; companyName?: string }) => {
    // F-2 v2: /api/console/signup returns 202 + { status: 'pending_verification', message }.
    // No token or API key here — those arrive on /dashboard/signup-complete after the
    // user clicks the verification link in their inbox.
    const res = await api.signup(input);
    return { status: res.status, message: res.message };
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setState({ status: 'unauthenticated', account: null, error: null });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    login,
    signup,
    logout,
    refresh,
  }), [state, login, signup, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
