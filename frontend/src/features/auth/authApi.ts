import {
  ApiError,
  apiClient,
  getPreauthCsrfToken,
  setCsrfToken,
  setPreauthCsrfToken,
} from '@/lib/apiClient';
import { API_BASE_URL } from '@/lib/env';
import type {
  AuthMessageResponse,
  DataEnvelope,
  PasswordLoginResponse,
  PreauthCsrfResponse,
  SessionResponse,
} from '@/lib/types';

export function getGoogleLoginUrl(): string {
  return `${API_BASE_URL}/auth/google`;
}

export async function fetchSession(): Promise<SessionResponse> {
  const response = await apiClient.get<SessionResponse>('/auth/session');
  setCsrfToken(response.data.csrfToken);
  return response.data;
}

export async function logoutSession(): Promise<void> {
  try {
    await apiClient.post('/auth/logout', {});
  } finally {
    setCsrfToken(null);
  }
}

export async function fetchPreauthCsrf(): Promise<PreauthCsrfResponse> {
  const response = await apiClient.get<PreauthCsrfResponse>('/auth/csrf');
  setPreauthCsrfToken(response.data.csrfToken);
  return response.data;
}

async function postPreauth<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let token = getPreauthCsrfToken();
  if (!token) {
    const csrf = await fetchPreauthCsrf();
    token = csrf.csrfToken;
  }

  try {
    const response = await apiClient.post<T>(path, body, {
      headers: { 'X-CSRF-Token': token },
    });
    return response.data;
  } catch (err) {
    // Per email-password-auth-contract.md: on 403 CSRF_INVALID, refetch GET /auth/csrf and retry explicit action at most once
    if (err instanceof ApiError && err.status === 403 && err.code === 'CSRF_INVALID') {
      const refreshed = await fetchPreauthCsrf();
      const retryResponse = await apiClient.post<T>(path, body, {
        headers: { 'X-CSRF-Token': refreshed.csrfToken },
      });
      return retryResponse.data;
    }
    throw err;
  }
}

export async function registerWithEmail(email: string): Promise<AuthMessageResponse> {
  const res = await postPreauth<DataEnvelope<AuthMessageResponse>>('/auth/register', { email });
  return res.data;
}

export async function registerWithPassword(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<AuthMessageResponse> {
  const res = await postPreauth<DataEnvelope<AuthMessageResponse>>('/auth/register', {
    email: input.email,
    displayName: input.displayName,
    password: input.password,
  });
  return res.data;
}

export async function verifyEmailRegistration(input: {
  token: string;
  displayName: string;
  password: string;
}): Promise<AuthMessageResponse> {
  const res = await postPreauth<DataEnvelope<AuthMessageResponse>>('/auth/verify-email', {
    token: input.token,
    displayName: input.displayName,
    password: input.password,
  });
  return res.data;
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
}): Promise<PasswordLoginResponse> {
  const res = await postPreauth<DataEnvelope<PasswordLoginResponse>>('/auth/login', {
    email: input.email,
    password: input.password,
  });
  return res.data;
}

export async function requestPasswordReset(email: string): Promise<AuthMessageResponse> {
  const res = await postPreauth<DataEnvelope<AuthMessageResponse>>('/auth/forgot-password', {
    email,
  });
  return res.data;
}

export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<AuthMessageResponse> {
  const res = await postPreauth<DataEnvelope<AuthMessageResponse>>('/auth/reset-password', {
    token: input.token,
    password: input.password,
  });
  return res.data;
}

const ALLOWED_REDIRECT_PREFIXES = ['/account', '/cart', '/checkout', '/admin', '/products', '/support'];

export function getSafeInternalRedirect(candidate: unknown): string {
  if (typeof candidate !== 'string' || !candidate) return '/account';
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/account';
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return '/account';

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return '/account';
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('\\') || decoded.includes('://')) {
    return '/account';
  }

  const pathname = trimmed.split('?')[0].split('#')[0];
  if (pathname === '/') return '/';
  const isAllowed = ALLOWED_REDIRECT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  return isAllowed ? trimmed : '/account';
}

export function extractAndClearFragmentToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash || '';
  if (!hash.startsWith('#')) return null;

  const params = new URLSearchParams(hash.slice(1));
  const rawToken = params.get('token');

  // Always strip the fragment immediately so the token never lingers in URL/history
  window.history.replaceState(null, '', window.location.pathname);

  if (!rawToken || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    return null;
  }
  return rawToken;
}
