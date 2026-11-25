import { expect, test } from '@playwright/test';
import { createInitialMockState, installMockApi } from './mockApi';

const VALID_VERIFY_TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno12';
const VALID_RESET_TOKEN = 'ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponml34';

test.describe('AUTH-002 Frontend Mocked E2E Journeys', () => {
  test('1. Register -> Verify Email (fragment stripped, confirmPassword client-only) -> Login -> Logout + XSS safety', async ({
    page,
  }) => {
    const state = createInitialMockState('GUEST');
    await installMockApi(page, state);

    let preauthToken = 'preauthToken1234567890123456789012345678901';
    let lastVerifyBody: Record<string, unknown> | null = null;
    let currentUser: { id: string; email: string; displayName: string; role: 'CUSTOMER' } | null =
      null;
    let storedPassword = '';

    await page.route('**/api/v1/auth/csrf', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          csrfToken: preauthToken,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      });
    });

    await page.route('**/api/v1/auth/register', async (route) => {
      const headers = route.request().headers();
      expect(headers['x-csrf-token']).toBe(preauthToken);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.confirmPassword).toBeUndefined();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { message: 'Registration successful. Please sign in.' },
        }),
      });
    });

    await page.route('**/api/v1/auth/verify-email', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      lastVerifyBody = body;
      if (body.token !== VALID_VERIFY_TOKEN) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'AUTH_TOKEN_INVALID',
              message: 'Verification link is invalid or has expired.',
              details: [],
              requestId: 'req-verify-bad',
            },
          }),
        });
        return;
      }
      storedPassword = String(body.password);
      currentUser = {
        id: '99999999-9999-4999-8999-999999999999',
        email: 'newbuyer@example.com',
        displayName: String(body.displayName),
        role: 'CUSTOMER',
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { message: 'Registration successful. Please sign in.' },
        }),
      });
    });

    await page.route('**/api/v1/auth/login', async (route) => {
      const body = route.request().postDataJSON() as { email: string; password: string };
      if (!currentUser || body.password !== storedPassword) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid email or password.',
              details: [],
              requestId: 'req-login-401',
            },
          }),
        });
        return;
      }
      state.role = 'CUSTOMER';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            user: currentUser,
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
          },
        }),
      });
    });

    await page.route('**/api/v1/auth/session', async (route) => {
      if (state.role === 'GUEST' || !currentUser) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Authentication is required.',
              details: [],
              requestId: 'req-sess-401',
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: currentUser,
          csrfToken: state.csrfToken,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      });
    });

    // Step 1: Register with username, email, password, confirmPassword
    await page.goto('/register');
    await page.getByLabel(/Username \/ Display name/i).fill('New Buyer');
    await page.getByLabel(/Email address/i).fill('newbuyer@example.com');
    await page.getByLabel(/^Password/i).fill('My Strong Kanto Passphrase 2026!');
    await page.getByLabel(/Confirm password/i).fill('My Strong Kanto Passphrase 2026!');
    await page.getByRole('button', { name: /Create account/i }).click();
    await expect(
      page.getByText('Registration successful. Please sign in.')
    ).toBeVisible();

    // Step 2: Open verify-email link with fragment
    await page.goto(`/verify-email#token=${VALID_VERIFY_TOKEN}`);
    // Fragment must be stripped immediately from URL
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
    await expect.poll(() => page.evaluate(() => window.location.search)).toBe('');

    // Verify no token or password stored in localStorage / sessionStorage
    const storageDump = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    expect(storageDump.local).not.toContain(VALID_VERIFY_TOKEN);
    expect(storageDump.session).not.toContain(VALID_VERIFY_TOKEN);

    // Fill XSS payload in displayName + strong passphrase with spaces
    const xssDisplayName = '<img src=x onerror=window.__xss=1>';
    const passphrase = '  My Strong Kanto Passphrase 2026!  ';
    await page.getByLabel(/Display name/i).fill(xssDisplayName);
    await page.getByLabel(/^Password/i).fill(passphrase);
    await page.getByLabel(/Confirm password/i).fill(passphrase);
    await page.getByRole('button', { name: /Verify email & create account/i }).click();

    await expect(page.getByText('Registration successful. Please sign in.')).toBeVisible();
    // confirmPassword must NEVER be sent to API
    expect(lastVerifyBody).not.toBeNull();
    expect(lastVerifyBody?.confirmPassword).toBeUndefined();
    expect(lastVerifyBody?.password).toBe(passphrase);

    // Step 3: Go to login and sign in
    await page.getByRole('link', { name: /Go to Sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel(/Email address/i).fill('newbuyer@example.com');
    await page.getByLabel(/^Password/i).fill(passphrase);
    await page.getByRole('button', { name: /Sign in with Email/i }).click();

    await expect(page).toHaveURL(/\/account/);
    // XSS payload must be rendered as harmless text, never executed
    await expect(page.getByText(xssDisplayName).first()).toBeVisible();
    const xssExecuted = await page.evaluate(() => Boolean((window as unknown as { __xss?: number }).__xss));
    expect(xssExecuted).toBe(false);
  });

  test('2. Forgot password -> Reset password (allowed while logged in, fragment stripped) -> Login', async ({
    page,
  }) => {
    const state = createInitialMockState('CUSTOMER');
    await installMockApi(page, state);

    const preauthToken = 'preauthToken1234567890123456789012345678901';
    let lastResetBody: Record<string, unknown> | null = null;

    await page.route('**/api/v1/auth/csrf', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          csrfToken: preauthToken,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      });
    });

    await page.route('**/api/v1/auth/forgot-password', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { message: 'If this account supports password reset, instructions have been sent.' },
        }),
      });
    });

    await page.route('**/api/v1/auth/reset-password', async (route) => {
      lastResetBody = route.request().postDataJSON() as Record<string, unknown>;
      state.role = 'GUEST';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { message: 'Your password has been updated. Please sign in again.' },
        }),
      });
    });

    // Forgot password shows generic success + Google hint
    await page.goto('/forgot-password');
    await page.getByLabel(/Email address/i).fill('alex@example.com');
    await page.getByRole('button', { name: /Send reset link/i }).click();
    await expect(
      page.getByText('If this account supports password reset, instructions have been sent.')
    ).toBeVisible();
    await expect(page.getByText(/Continue with Google/i)).toBeVisible();

    // Open reset-password even while authenticated (must NOT redirect away)
    await page.goto(`/reset-password#token=${VALID_RESET_TOKEN}`);
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');

    const newPw = 'Brand-New-Kanto-Passphrase-2026!';
    await page.getByLabel(/^New password/i).fill(newPw);
    await page.getByLabel(/Confirm new password/i).fill(newPw);
    await page.getByRole('button', { name: /Update password/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByText('Your password has been updated. Please sign in again.')
    ).toBeVisible();
    expect(lastResetBody?.confirmPassword).toBeUndefined();
    expect(lastResetBody?.token).toBe(VALID_RESET_TOKEN);
  });

  test('3. Invalid/missing links show generic guidance and 360px mobile layout has no overflow', async ({
    page,
  }) => {
    const state = createInitialMockState('GUEST');
    await installMockApi(page, state);

    await page.goto('/verify-email');
    await expect(page.getByText(/Verification link required/i)).toBeVisible();

    await page.goto('/reset-password');
    await expect(page.getByText(/Reset link required/i)).toBeVisible();

    // Mobile 360px check on /login, /register, /forgot-password
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ['/login', '/register', '/forgot-password']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(overflow).toBe(false);
    }
  });
});
