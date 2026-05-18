import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import { AppShell, EnvironmentProvider } from './components/layout/AppShell';
import { ToastViewport } from './components/ui';
import { Login } from './routes/public/Login';
import { Signup } from './routes/public/Signup';
import { SignupComplete } from './routes/public/SignupComplete';
import { Overview } from './routes/Overview';
import { ApiKeys } from './routes/ApiKeys';
import { Users } from './routes/Users';
import { Devices } from './routes/Devices';
import { Verifications } from './routes/Verifications';
import { Attendance } from './routes/Attendance';
import { Audit } from './routes/Audit';
import { Settings } from './routes/Settings';
import { NotFound } from './routes/NotFound';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, err) => {
        // Don't retry 4xx; do retry 5xx and network errors up to 1x.
        const status = (err as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
});

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-current border-r-transparent text-[var(--color-text-dim)]" />
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter basename="/dashboard">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <EnvironmentProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/signup-complete" element={<SignupComplete />} />

              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<Navigate to="/overview" replace />} />
                  <Route path="/overview" element={<Overview />} />
                  <Route path="/api-keys" element={<ApiKeys />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/devices" element={<Devices />} />
                  <Route path="/verifications" element={<Verifications />} />
                  <Route path="/attendance" element={<Attendance />} />
                  <Route path="/audit" element={<Audit />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
            </Routes>

            <ToastViewport />
          </EnvironmentProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
