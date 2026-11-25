import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  UserPlus,
  ShoppingBag,
  ShieldCheck,
  PackageCheck,
  ArrowRight,
} from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { PasswordRequirements } from '@/components/ui/PasswordRequirements';
import { ApiError } from '@/lib/apiClient';
import { evaluatePasswordPolicy, isValidEmailAddress } from '@/lib/validation';
import { registerWithPassword } from '@/features/auth/authApi';
import { GoogleLoginButton } from '@/features/auth/GoogleLoginButton';

function codePointCount(value: string): number {
  return Array.from(value.normalize('NFC')).length;
}

export function RegisterPage() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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

  const pwPolicy = evaluatePasswordPolicy(password);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || cooldownSec > 0) return;

    const nextErrors: Record<string, string> = {};
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || codePointCount(trimmedName) > 100) {
      nextErrors.displayName = 'Username / display name must be between 1 and 100 characters.';
    }
    if (!isValidEmailAddress(trimmedEmail)) {
      nextErrors.email = 'Enter a valid email address (e.g., you@example.com).';
    }
    if (!pwPolicy.valid && pwPolicy.firstError) {
      nextErrors.password = pwPolicy.firstError;
    }
    if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Passwords do not match.';
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
      // confirmPassword is client-only and NEVER sent to the backend API
      const res = await registerWithPassword({
        email: trimmedEmail,
        displayName: trimmedName,
        password,
      });
      setPassword('');
      setConfirmPassword('');
      setSuccessMessage(res.message);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          const waitSec = err.retryAfterSeconds ?? 60;
          setCooldownSec(waitSec);
          setFormError(`Too many requests. Please try again in ${waitSec} seconds.`);
        } else if (err.status === 409) {
          setFieldErrors({ email: err.message });
          setFormError(err.message);
        } else if ((err.code === 'PASSWORD_NOT_ALLOWED' || err.status === 400) && err.details.length > 0) {
          const mapped: Record<string, string> = {};
          for (const d of err.details) {
            if (d.field === 'email' || d.field === 'displayName' || d.field === 'password') {
              mapped[d.field] = d.message;
            }
          }
          setFieldErrors(mapped);
          setFormError(err.message);
        } else {
          setFormError(err.message || 'Unable to create your account right now.');
        }
      } else {
        setFormError('Unable to create your account right now.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl py-4 sm:py-8">
      <div className="grid overflow-hidden rounded-3xl border border-[#E6E4DD] bg-white shadow-[0_8px_30px_rgba(17,21,28,0.06)] lg:grid-cols-12">
        {/* Left editorial onboarding panel */}
        <aside className="relative flex flex-col justify-between gap-8 bg-[#11151C] p-6 sm:p-8 lg:col-span-5 lg:p-9 text-white overflow-hidden">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#0F4C81]/35 blur-3xl"
            aria-hidden="true"
          />

          <div className="relative space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-[#93C5FD]">
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Join Kanto</span>
            </div>

            <div className="space-y-2">
              <h2
                className="text-2xl font-bold tracking-tight text-white leading-snug"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Your workspace, synced across every order.
              </h2>
              <p className="text-sm leading-relaxed text-[#A7B0BE]">
                Create your personal account in seconds to save your cart, reserve live stock, and
                track every shipment.
              </p>
            </div>

            <ul className="space-y-3.5 pt-2 text-xs text-[#CBD5E1]">
              <li className="flex items-start gap-2.5">
                <ShoppingBag className="h-4 w-4 text-[#3B9EFF] shrink-0 mt-0.5" aria-hidden="true" />
                <span>Persistent multi-device shopping cart with server-verified pricing</span>
              </li>
              <li className="flex items-start gap-2.5">
                <PackageCheck className="h-4 w-4 text-[#4ADE80] shrink-0 mt-0.5" aria-hidden="true" />
                <span>Instant inventory reservation &amp; live order history tracking</span>
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-[#93C5FD] shrink-0 mt-0.5" aria-hidden="true" />
                <span>Argon2id passphrase hashing &amp; HttpOnly session cookies</span>
              </li>
            </ul>
          </div>

          <div className="relative border-t border-white/10 pt-4 text-xs text-[#94A3B8]">
            Already registered with Google? Use <strong className="text-white">Sign up with Google</strong> or sign in directly.
          </div>
        </aside>

        {/* Right full registration form */}
        <div className="p-6 sm:p-8 lg:col-span-7 lg:p-10 flex flex-col justify-center space-y-5">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold text-[#11151C] sm:text-3xl">
              Create a Kanto account
            </h1>
            <p className="text-sm leading-relaxed text-[#555E6D]">
              Sign up with Google or fill in your username, email, and passphrase below.
            </p>
          </div>

          <GoogleLoginButton label="Sign up with Google" />

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-[#E6E4DD]" />
            <span className="mx-3 text-xs font-medium uppercase tracking-wider text-[#7A828F]">
              or create with email
            </span>
            <div className="flex-grow border-t border-[#E6E4DD]" />
          </div>

          <div ref={statusRef} tabIndex={-1} aria-live="polite" className="outline-none space-y-3">
            {successMessage && (
              <Alert tone="success" title="Account created">
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
              <Alert tone="error" title="Could not create account">
                {formError}
              </Alert>
            )}
          </div>

          {!successMessage && (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <Input
                id="register-display-name"
                label="Username / Display name"
                type="text"
                autoComplete="name"
                placeholder="Alex Rivera"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                error={fieldErrors.displayName}
                disabled={submitting}
              />

              <Input
                id="register-email"
                label="Email address"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={fieldErrors.email}
                disabled={submitting}
              />

              <div className="space-y-1.5">
                <PasswordInput
                  id="register-password"
                  label="Password"
                  autoComplete="new-password"
                  placeholder="Min 8 chars: A-Z, a-z, 0-9, !@#$..."
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={fieldErrors.password}
                  disabled={submitting}
                />
                <PasswordRequirements password={password} />
              </div>

              <PasswordInput
                id="register-confirm-password"
                label="Confirm password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
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
                disabled={submitting || cooldownSec > 0}
                className="w-full"
              >
                <span>{cooldownSec > 0 ? `Wait ${cooldownSec}s` : 'Create account'}</span>
                {cooldownSec === 0 && !submitting && (
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </form>
          )}

          <div className="border-t border-[#EFEDE7] pt-4 text-xs text-[#6B7684] flex flex-wrap items-center justify-between gap-2">
            <p>
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-[#0F4C81] hover:underline">
                Sign in
              </Link>
            </p>
            <Link to="/" className="hover:text-[#11151C] transition-colors">
              Back to catalog
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
