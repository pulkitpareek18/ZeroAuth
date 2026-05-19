import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../../lib/auth';
import { ThemeProvider } from '../../lib/theme';
import { Login } from './Login';
import { setToken } from '../../lib/api';

function renderLoginAt(path = '/login') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/overview" element={<div>Overview page</div>} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('<Login />', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    setToken(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setToken(null);
  });

  it('renders the form and a link to signup', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    }) as unknown as typeof fetch;

    renderLoginAt();
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create one/i })).toBeInTheDocument();
  });

  it('shows an inline error when /login returns 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'invalid_credentials', message: 'Invalid email or password.' }),
    }) as unknown as typeof fetch;

    renderLoginAt();
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password-123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });

  it('redirects to /overview after a successful login', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      calls += 1;
      if (typeof url === 'string' && url.includes('/api/console/login')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            token: 'jwt-test',
            tenant: { id: 't', email: 'a@b.test', companyName: null, plan: 'free', status: 'active' },
          }),
        };
      }
      // /api/console/account fired by refresh()
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 't', email: 'a@b.test', companyName: null, plan: 'free', status: 'active',
          rateLimit: 100, monthlyQuota: 1000, createdAt: new Date().toISOString(),
        }),
      };
    }) as unknown as typeof fetch;

    renderLoginAt();
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'CorrectPassword123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText(/overview page/i)).toBeInTheDocument());
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
