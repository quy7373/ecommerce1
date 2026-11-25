import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { PasswordRequirements } from '@/components/ui/PasswordRequirements';
import { ApiError } from '@/lib/apiClient';
import { evaluatePasswordPolicy } from '@/lib/validation';
import { useAuth } from '@/features/auth/AuthContext';
import { useCart } from '@/features/cart/CartContext';
import { extractAndClearFragmentToken, resetPassword } from '@/features/auth/authApi';

export function ResetPasswordPage() {
  // Per auth-implementation-plan.md: do NOT redirect away even if an old session is still active
  const { clearAuth } = useAuth();
  const { clearLocalCart } = useCart();
  const navigate = useNavigate();

  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const extracted = extractAndClearFragmentToken();
    setToken(extracted);
    setTokenChecked(true);
  }, []);

  useEffect(() => {
    if (formError) {
      statusRef.current?.focus();
    }
  }, [formError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !token) return;

    const nextErrors: Record<string, string> = {};
    const pwPolicy = evaluatePasswordPolicy(password);
    if (!pwPolicy.valid && pwPolicy.firstError) {
      nextErrors.password = pwPolicy.firstError;
    }
    if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError('Please fix the highlighted fields.');
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);

    try {
      // confirmPassword is client-only and is NEVER sent to the backend API
      const res = await resetPassword({ token, password });
      setToken(null);
      setPassword('');
      setConfirmPassword('');
      // Clear local private auth/cart caches and redirect to /login without auto-login
      clearAuth();
      clearLocalCart();
      navigate('/login', { replace: true, state: { notice: res.message } });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'AUTH_TOKEN_INVALID') {
          setToken(null);
          setTokenInvalid(true);
          setFormError('This password reset link is invalid or has expired.');
        } else if (err.code === 'PASSWORD_NOT_ALLOWED' || err.status === 400) {
          const mapped: Record<string, string> = {};
          for (const d of err.details) {
            if (d.field === 'password') {
              mapped.password = d.message;
            }
          }
          setFieldErrors(mapped);
          setFormError(err.message);
        } else if (err.status === 429) {
          const waitSec = err.retryAfterSeconds ?? 60;
          setFormError(`Too many requests. Please try again in ${waitSec} seconds.`);
        } else {
          setFormError(err.message || 'Unable to reset password right now.');
        }
      } else {
        setFormError('Unable to reset password right now.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10 px-1">
      <Card className="p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[#161B22]">Set a new password</h1>
          <p className="text-sm leading-relaxed text-[#525C68]">
            Updating your password will sign out all active sessions across your devices.
          </p>
        </div>

        <div ref={statusRef} tabIndex={-1} aria-live="polite" className="outline-none space-y-3">
          {formError && (
            <Alert tone="error" title="Password reset failed">
              {formError}
            </Alert>
          )}
        </div>

        {tokenChecked && (!token || tokenInvalid) && (
          <div className="space-y-4">
            <Alert tone="warning" title="Reset link required">
              Open the password reset link directly from your email, or request a new link if yours
              has expired or been used.
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Link to="/forgot-password">
                <Button variant="primary">Request a new reset link</Button>
              </Link>
              <Link to="/login">
                <Button variant="outline">Back to Sign in</Button>
              </Link>
            </div>
          </div>
        )}

        {token && !tokenInvalid && (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <PasswordInput
                id="reset-password"
                label="New password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={fieldErrors.password}
                disabled={submitting}
              />
              <PasswordRequirements password={password} />
            </div>

            <PasswordInput
              id="reset-confirm-password"
              label="Confirm new password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={fieldErrors.confirmPassword}
              disabled={submitting}
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={submitting}
              className="w-full"
            >
              Update password
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
