import { expect, test } from '@playwright/test';
import { createInitialMockState, installMockApi } from './mockApi';

test.describe('E-Commerce Frontend Critical Flows', () => {
  test('1. Visitor browses, searches, filters, views product detail, and checks 360px mobile layout', async ({
    page,
  }) => {
    const state = createInitialMockState('GUEST');
    await installMockApi(page, state);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Precision tools for focused work.' })).toBeVisible();
    await expect(page.getByText('Tactile Mechanical Keyboard')).toBeVisible();
    await expect(page.getByText('Wireless Ergonomic Mouse')).toBeVisible();
    await expect(page.getByText('Wool Felt Desk Mat')).toBeVisible();

    // Filter by search
    await page.getByLabel('Search (name, description, SKU)').fill('Keyboard');
    await expect(page.getByText('Tactile Mechanical Keyboard')).toBeVisible();
    await expect(page.getByText('Wireless Ergonomic Mouse')).toBeHidden();

    // Reset and open product detail
    await page.getByRole('button', { name: 'Reset Filters' }).click();
    await page.getByRole('link', { name: 'Tactile Mechanical Keyboard' }).first().click();

    await expect(page).toHaveURL(/\/products\/aaaa1111/);
    await expect(page.getByRole('heading', { name: 'Tactile Mechanical Keyboard' })).toBeVisible();
    await expect(page.getByText('$129.00')).toBeVisible();
    await expect(page.getByText('In Stock (15)')).toBeVisible();

    // Mobile 360px layout check
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('2. Unauthenticated visitor is redirected from protected routes to Login with Google button', async ({
    page,
  }) => {
    const state = createInitialMockState('GUEST');
    await installMockApi(page, state);

    await page.goto('/cart');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in to Kanto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  test('3. Customer adds to cart, updates quantity, validates checkout form, and initiates Stripe redirect', async ({
    page,
  }) => {
    const state = createInitialMockState('CUSTOMER');
    await installMockApi(page, state);

    // Intercept external Stripe navigation so Playwright stays in test harness
    let stripeRedirectUrl = '';
    await page.route('https://checkout.stripe.com/**', async (route) => {
      stripeRedirectUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body><h1>Mock Stripe Checkout</h1></body></html>',
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Add Tactile Mechanical Keyboard to cart' }).click();
    await expect(page.getByText('Added "Tactile Mechanical Keyboard" to your cart.')).toBeVisible();

    await page.getByRole('link', { name: /Shopping cart, 1 items/ }).click();
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByText('$129.00').first()).toBeVisible();

    // Increase quantity to 2
    await page
      .getByRole('button', { name: 'Increase quantity of Tactile Mechanical Keyboard' })
      .click();
    await expect(page.getByText('$258.00').first()).toBeVisible();

    // Proceed to checkout
    await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
    await expect(page).toHaveURL(/\/checkout/);

    // Submit invalid form first to verify client-side validation
    await page.getByRole('button', { name: 'Place Order & Pay' }).click();
    await expect(page.getByText('Full name is required (1–100 characters).')).toBeVisible();
    await expect(page.getByText(/Use a 5-digit US ZIP code/)).toBeVisible();

    // Fill valid US shipping address
    await page.getByLabel('Full Name').fill('Alex Rivera');
    await page.getByLabel('Address Line 1').fill('123 Market St');
    await page.getByLabel('City').fill('San Francisco');
    await page.getByLabel('State / Region').fill('CA');
    await page.getByLabel('US ZIP Code').fill('94107');
    await page.getByLabel('Phone Number (Optional)').fill('+14155550199');

    await page.getByRole('button', { name: 'Place Order & Pay' }).click();
    await expect(page.getByRole('heading', { name: 'Mock Stripe Checkout' })).toBeVisible();

    expect(stripeRedirectUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_123456');
    expect(state.lastOrderIdempotencyKey).toBeTruthy();
    expect(state.lastCheckoutIdempotencyKey).toBeTruthy();
    expect(state.lastCsrfHeader).toBe(state.csrfToken);
  });

  test('4. Customer views order history, cancels pending order, and sees return banner', async ({
    page,
  }) => {
    const state = createInitialMockState('CUSTOMER');
    await installMockApi(page, state);

    await page.goto('/account?orderId=dddd2222-2222-4222-8222-222222222222&payment=returned');
    await expect(page.getByText('Returned from Stripe Checkout')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Pending Payment')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel Pending Order' }).click();
    await expect(page.getByRole('dialog').getByText('Cancelled')).toBeVisible();
  });

  test('5. Customer is denied Admin Dashboard; Admin manages products and advances order status', async ({
    page,
  }) => {
    // Part A: Customer gets Access Denied
    const customerState = createInitialMockState('CUSTOMER');
    await installMockApi(page, customerState);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();

    // Part B: Admin creates product & advances PAID order -> PROCESSING -> SHIPPED
    const adminState = createInitialMockState('ADMIN');
    await page.unroute('**/api/v1/**');
    await installMockApi(page, adminState);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

    // Add Product
    await page.getByRole('button', { name: 'Add Product' }).click();
    await page.getByLabel('SKU').fill('HUB-USB-004');
    await page.getByLabel('Product Name').fill('USB-C Multiport Hub');
    await page.getByLabel('Price (USD)').fill('49.50');
    await page.getByLabel('Stock On Hand').fill('20');
    await page.getByRole('button', { name: 'Create Product' }).click();
    await expect(page.getByRole('cell', { name: 'USB-C Multiport Hub' })).toBeVisible();

    // Switch to Orders tab and advance PAID order to PROCESSING then SHIPPED
    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Manage' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Mark as Processing' }).click();
    await expect(page.getByRole('dialog').getByText('Processing')).toBeVisible();

    await page.getByRole('button', { name: 'Mark as Shipped' }).click();
    await expect(page.getByRole('dialog').getByText('Shipped')).toBeVisible();
  });

  test('6. AI Support Center renders cited answers and escalates unsupported questions safely', async ({
    page,
  }) => {
    const state = createInitialMockState('GUEST');
    await installMockApi(page, state);

    await page.goto('/support');
    await expect(page.getByRole('heading', { name: 'AI Support Center' })).toBeVisible();

    // Ask supported shipping question
    await page.getByRole('button', { name: 'What is the shipping policy?' }).click();
    await expect(
      page.getByText('Standard US test-market shipping is currently $0.00 in demo mode.')
    ).toBeVisible();
    await expect(page.getByText('Shipping Policy', { exact: true })).toBeVisible();
    await expect(page.getByText('US Shipping Rates', { exact: true })).toBeVisible();

    // Ask unsupported question -> exact escalation message
    await page.getByLabel('Ask a support question').fill('Do you offer international drone delivery?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(
      page.getByText(
        'I cannot confirm this from approved store information. Please contact store support.'
      )
    ).toBeVisible();
    await expect(page.getByText(/Escalated to human store support/)).toBeVisible();
  });
});
