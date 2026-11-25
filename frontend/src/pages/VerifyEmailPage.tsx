import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { PasswordRequirements } from '@/components/ui/PasswordRequirements';
import { ApiError } from '@/lib/apiClient';
import { evaluatePasswordPolicy } from '@/lib/validation';
import {
  extractAndClearFragmentToken,
  verifyEmailRegistration,
} from '@/features/auth/authApi';

function codePointCount(value: string): number {
  return Array.from(value.normalize('NFC')).length;
}

export function VerifyEmailPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenChecked, setTokenChecked] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const extracted = extractAndClearFragmentToken();
    setToken(extracted);
    setTokenChecked(true);
  }, []);

  useEffect(() => {
    if (formError || successMessage) {
      statusRef.current?.focus();
    }
  }, [formError, successMessage]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !token) return;

    const nextErrors: Record<string, string> = {};
    const trimmedName = displayName.trim();
    if (!trimmedName || codePointCount(trimmedName) > 100) {
      nextErrors.displayName = 'Display name must be between 1 and 100 characters.';
    }
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
      const res = await verifyEmailRegistration({
        token,
        displayName: trimmedName,
        password,
      });
      setToken(null);
      setPassword('');
      setConfirmPassword('');
      setSuccessMessage(res.message);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'AUTH_TOKEN_INVALID') {
          setToken(null);
          setTokenInvalid(true);
          setFormError('This verification link is invalid or has expired. Please register again.');
        } else if (err.code === 'PASSWORD_NOT_ALLOWED' || err.status === 400) {
          const mapped: Record<string, string> = {};
          for (const d of err.details) {
            if (d.field === 'password' || d.field === 'displayName') {
              mapped[d.field] = d.message;
            }
          }
          setFieldErrors(mapped);
          setFormError(err.message);
        } else if (err.status === 429) {
          const waitSec = err.retryAfterSeconds ?? 60;
          setFormError(`Too many requests. Please try again in ${waitSec} seconds.`);
        } else {
          setFormError(err.message || 'Unable to complete verification right now.');
        }
      } else {
        setFormError('Unable to complete verification right now.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-10 px-1">
      <Card className="p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[#161B22]">Complete your registration</h1>
          <p className="text-sm leading-relaxed text-[#525C68]">
            Choose your display name and a strong password (8–128 characters; spaces and Unicode
            characters are supported).
          </p>
        </div>

        <div ref={statusRef} tabIndex={-1} aria-live="polite" className="outline-none space-y-3">
          {successMessage && (
            <Alert tone="success" title="Registration complete">
              <p>{successMessage}</p>
              <div className="mt-3">
                <Link to="/login">
                  <Button variant="primary" size="sm">
                    Go to Sign in
                  </Button>
                </Link>
              </div>
            </Alert>
          )}

          {formError && (
            <Alert tone="error" title="Verification failed">
              {formError}
            </Alert>
          )}
        </div>

        {!successMessage && tokenChecked && (!token || tokenInvalid) && (
          <div className="space-y-4">
            <Alert tone="warning" title="Verification link required">
              Open the verification link directly from your email, or request a new verification link
              if yours has expired or been used.
            </Alert>
            <div className="flex flex-wrap gap-3">
              <Link to="/register">
                <Button variant="primary">Request a new link</Button>
              </Link>
              <Link to="/login">
                <Button variant="outline">Back to Sign in</Button>
              </Link>
            </div>
          </div>
        )}

        {!successMessage && token && !tokenInvalid && (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <Input
              id="verify-display-name"
              label="Display name"
              type="text"
              autoComplete="name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              error={fieldErrors.displayName}
              disabled={submitting}
            />

            <div className="space-y-1.5">
              <PasswordInput
                id="verify-password"
                label="Password"
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
              id="verify-confirm-password"
              label="Confirm password"
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
              Verify email &amp; create account
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
