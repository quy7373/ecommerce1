import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/apiClient';
import { isValidEmailAddress } from '@/lib/validation';
import { requestPasswordReset } from '@/features/auth/authApi';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cooldownSec, setCooldownSec] = useState(0);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cooldownSec <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldownSec((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSec]);

  useEffect(() => {
    if (formError || successMessage) {
      statusRef.current?.focus();
    }
  }, [formError, successMessage]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || cooldownSec > 0) return;

    const trimmed = email.trim();
    if (!isValidEmailAddress(trimmed)) {
      setFieldError('Enter a valid email address (e.g., you@example.com).');
      setFormError('Please provide a valid email address.');
      return;
    }

    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await requestPasswordReset(trimmed);
      setSuccessMessage(res.message);
      setCooldownSec(60);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const waitSec = err.retryAfterSeconds ?? 60;
          setCooldownSec(waitSec);
          setFormError(`Too many requests. Please try again in ${waitSec} seconds.`);
        } else if (err.status === 400 && err.details.length > 0) {
          setFieldError(err.details[0].message);
          setFormError(err.message);
        } else {
          setFormError(err.message || 'Unable to process password reset request right now.');
        }
      } else {
        setFormError('Unable to process password reset request right now.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-6 sm:py-10 px-1">
      <Card className="p-6 sm:p-8 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#F2D8AE] bg-[#FDF6EC] text-[#9A5B13]"
              aria-hidden="true"
            >
              <KeyRound className="h-5 w-5" />
            </span>
            <span className="rounded-full bg-[#FDF6EC] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A5B13]">
              Account Recovery
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[#11151C]">Reset your password</h1>
          <p className="text-sm leading-relaxed text-[#555E6D]">
            Enter your email address and we will send password reset instructions if your account
            supports password sign-in.
          </p>
        </div>

        <div ref={statusRef} tabIndex={-1} aria-live="polite" className="outline-none space-y-3">
          {successMessage && (
            <Alert tone="success" title="Reset instructions requested">
              <p>{successMessage}</p>
              <p className="mt-2 text-xs">
                If you originally created your account with Google, use{' '}
                <Link to="/login" className="font-semibold underline">
                  Continue with Google
                </Link>{' '}
                on the sign-in page instead.
              </p>
            </Alert>
          )}
          {formError && (
            <Alert tone="error" title="Could not continue">
              {formError}
            </Alert>
          )}
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Input
            id="forgot-email"
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError}
            disabled={submitting}
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={submitting || cooldownSec > 0}
            className="w-full"
          >
            {cooldownSec > 0
              ? `Resend available in ${cooldownSec}s`
              : successMessage
                ? 'Resend reset link'
                : 'Send reset link'}
          </Button>
        </form>

        <div className="border-t border-[#DDE2E7] pt-4 text-xs text-[#6B7684] space-y-1.5">
          <p>
            Remembered your password?{' '}
            <Link to="/login" className="font-medium text-[#0F4C81] hover:underline">
              Back to Sign in
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
