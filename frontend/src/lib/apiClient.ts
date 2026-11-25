import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './env';
import type { ErrorBody, ErrorDetail } from './types';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: ErrorDetail[];
  public readonly requestId: string | null;
  public readonly retryAfterSeconds: number | null;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details ?? [];
    this.requestId = params.requestId ?? null;
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

// In-memory CSRF tokens only — never persisted in localStorage/sessionStorage
let csrfTokenInMemory: string | null = null;
let preauthCsrfTokenInMemory: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
let csrfRefreshHandler: (() => Promise<string | null>) | null = null;

export function setCsrfToken(token: string | null): void {
  csrfTokenInMemory = token;
}

export function getCsrfToken(): string | null {
  return csrfTokenInMemory;
}

export function setPreauthCsrfToken(token: string | null): void {
  preauthCsrfTokenInMemory = token;
}

export function getPreauthCsrfToken(): string | null {
  return preauthCsrfTokenInMemory;
}

export function registerApiHandlers(handlers: {
  onUnauthorized?: () => void;
  onCsrfInvalid?: () => Promise<string | null>;
}): void {
  unauthorizedHandler = handlers.onUnauthorized ?? null;
  csrfRefreshHandler = handlers.onCsrfInvalid ?? null;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
  },
});

const MUTATING_METHODS = new Set(['post', 'patch', 'delete', 'put']);
const PREAUTH_PATHS = new Set([
  '/auth/register',
  '/auth/verify-email',
  '/auth/login',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

function isPreauthPath(url: string): boolean {
  const path = url.split('?')[0];
  return PREAUTH_PATHS.has(path);
}

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const method = (config.method || 'get').toLowerCase();
  const url = config.url || '';
  const isPublicSupport = url.startsWith('/support/messages');
  const isPreauth = isPreauthPath(url);

  if (MUTATING_METHODS.has(method)) {
    config.headers.set('Content-Type', 'application/json');
    if (isPreauth) {
      if (!config.headers.get('X-CSRF-Token') && preauthCsrfTokenInMemory) {
        config.headers.set('X-CSRF-Token', preauthCsrfTokenInMemory);
      }
    } else if (!isPublicSupport && csrfTokenInMemory) {
      config.headers.set('X-CSRF-Token', csrfTokenInMemory);
    }
  }

  return config;
});

function parseRetryAfter(headerValue: unknown): number | null {
  if (typeof headerValue !== 'string' && typeof headerValue !== 'number') return null;
  const parsed = Number(headerValue);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.ceil(parsed) : null;
}

export function normalizeApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<Partial<ErrorBody>>;
    const status = axiosErr.response?.status ?? 0;
    const body = axiosErr.response?.data;
    const headerRequestId =
      typeof axiosErr.response?.headers?.['x-request-id'] === 'string'
        ? axiosErr.response.headers['x-request-id']
        : null;
    const retryAfterSeconds = parseRetryAfter(axiosErr.response?.headers?.['retry-after']);

    if (body && body.error && typeof body.error.code === 'string') {
      return new ApiError({
        status,
        code: body.error.code,
        message: typeof body.error.message === 'string' ? body.error.message : 'Request failed.',
        details: Array.isArray(body.error.details) ? body.error.details : [],
        requestId: body.error.requestId || headerRequestId,
        retryAfterSeconds,
      });
    }

    if (axiosErr.code === 'ECONNABORTED') {
      return new ApiError({
        status: 504,
        code: 'REQUEST_TIMEOUT',
        message: 'The request timed out. Please try again.',
        requestId: headerRequestId,
      });
    }

    if (!axiosErr.response) {
      return new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Unable to reach the server. Check your connection and try again.',
      });
    }

    return new ApiError({
      status,
      code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED',
      message: status >= 500 ? 'An unexpected server error occurred.' : 'Request could not be completed.',
      requestId: headerRequestId,
      retryAfterSeconds,
    });
  }

  return new ApiError({
    status: 0,
    code: 'UNKNOWN_ERROR',
    message: err instanceof Error ? err.message : 'An unexpected error occurred.',
  });
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<Partial<ErrorBody>>) => {
    const apiError = normalizeApiError(error);
    const requestUrl = error.config?.url || '';

    if (
      apiError.status === 401 &&
      !requestUrl.includes('/auth/session') &&
      !isPreauthPath(requestUrl)
    ) {
      csrfTokenInMemory = null;
      unauthorizedHandler?.();
    }

    if (
      apiError.status === 403 &&
      apiError.code === 'CSRF_INVALID' &&
      !isPreauthPath(requestUrl) &&
      csrfRefreshHandler
    ) {
      // Per error-conventions.md: refetch session to obtain fresh CSRF token before intentional retry
      try {
        await csrfRefreshHandler();
      } catch {
        // Ignore refresh failure; caller will handle original error
      }
    }

    return Promise.reject(apiError);
  }
);
