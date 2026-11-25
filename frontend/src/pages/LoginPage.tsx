import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/apiClient';
import { isValidEmailAddress } from '@/lib/validation';
import { useAuth } from '@/features/auth/AuthContext';
import { getSafeInternalRedirect, loginWithPassword } from '@/features/auth/authApi';
import { GoogleLoginButton } from '@/features/auth/GoogleLoginButton';

interface LoginLocationState {
  from?: string;
  notice?: string;
}

export function LoginPage() {
  const { isAuthenticated, loading, refreshSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const authError = searchParams.get('error');
  const locationState = (location.state as LoginLocationState | null) ?? null;
  const redirectTarget = getSafeInternalRedirect(locationState?.from);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryCountdown, setRetryCountdown] = useState(0);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (retryCountdown <= 0) return undefined;
    const timer = window.setTimeout(() => setRetryCountdown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryCountdown]);

  useEffect(() => {
    if (formError) {
      errorSummaryRef.current?.focus();
    }
  }, [formError]);

  if (loading) {
    return <Spinner label="Checking sign-in status..." />;
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTarget} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || retryCountdown > 0) return;

    const nextErrors: Record<string, string> = {};
    const trimmedEmail = email.trim();
    if (!isValidEmailAddress(trimmedEmail)) {
      nextErrors.email = 'Enter a valid email address (e.g., you@example.com).';
    }
    if (!password) {
      nextErrors.password = 'Enter your password.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError('Please review the highlighted fields.');
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      await loginWithPassword({ email: trimmedEmail, password });
      setPassword('');
      await refreshSession();
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const waitSec = err.retryAfterSeconds ?? 60;
          setRetryCountdown(waitSec);
          setFormError(`Too many sign-in attempts. Try again in ${waitSec} seconds.`);
        } else if (err.status === 401) {
          setFormError('Invalid email or password.');
        } else if (err.status === 400 && err.details.length > 0) {
          const mapped: Record<string, string> = {};
          for (const d of err.details) {
            if (d.field === 'email' || d.field === 'password') {
              mapped[d.field] = d.message;
            }
          }
          setFieldErrors(mapped);
          setFormError(err.message);
        } else {
          setFormError(err.message || 'Sign-in is temporarily unavailable. Please try again.');
        }
      } else {
        setFormError('Sign-in could not be completed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-6 sm:py-10 px-1">
      <Card className="p-6 sm:p-8 space-y-6">
        <div className="space-y-2.5">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#11151C]"
            aria-hidden="true"
          >
            <span className="h-3 w-3 rounded-[2px] bg-[#3B9EFF]" />
          </span>
          <h1 className="text-2xl font-bold text-[#11151C]">Sign in to Kanto</h1>
          <p className="text-sm leading-relaxed text-[#555E6D]">
            Sign in with your email and password or continue with Google to manage your cart and orders.
          </p>
        </div>

        {locationState?.notice && (
          <Alert tone="success" title="Account updated">
            {locationState.notice}
          </Alert>
        )}

        {authError && (
          <Alert tone="error" title="Sign-in did not complete">
            Authentication could not be verified. Try signing in again.
          </Alert>
        )}

        {formError && (
          <div ref={errorSummaryRef} tabIndex={-1} className="outline-none">
            <Alert tone="error" title="Unable to sign in">
              {formError}
            </Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Input
            id="login-email"
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            disabled={submitting}
          />

          <PasswordInput
            id="login-password"
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            disabled={submitting}
          />

          <div className="flex items-center justify-end">
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-[#0F4C81] hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={submitting || retryCountdown > 0}
            className="w-full"
          >
            {retryCountdown > 0 ? `Wait ${retryCountdown}s` : 'Sign in with Email'}
          </Button>
        </form>

        <div className="relative flex items-center">
          <div className="flex-grow border-t border-[#DDE2E7]" />
          <span className="mx-3 text-xs uppercase tracking-wide text-[#6B7684]">or</span>
          <div className="flex-grow border-t border-[#DDE2E7]" />
        </div>

        <GoogleLoginButton />

        <div className="border-t border-[#DDE2E7] pt-4 text-xs text-[#6B7684] space-y-2">
          <p>
            New to Kanto?{' '}
            <Link to="/register" className="font-medium text-[#0F4C81] hover:underline">
              Create an account
            </Link>
          </p>
          <p>Sessions use HttpOnly cookies; no tokens are stored in browser storage.</p>
          <p>
            Just browsing?{' '}
            <Link to="/" className="font-medium text-[#0F4C81] hover:underline">
              Explore the catalog
            </Link>{' '}
            or{' '}
            <Link to="/support" className="font-medium text-[#0F4C81] hover:underline">
              open AI Support
            </Link>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}
