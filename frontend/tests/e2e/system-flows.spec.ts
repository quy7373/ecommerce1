import { expect, test } from '@playwright/test';
import { createInitialMockState, installMockApi } from './mockApi';

test.describe('System E2E: Theme, Delete Warnings, Order Deletion & Admin CRUD', () => {
  test('1. Dark/Light mode toggle updates html.dark class and persists across reload', async ({
    page,
  }) => {
    const state = createInitialMockState('GUEST');
    await installMockApi(page, state);

    await page.goto('/');
    const initialIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    const toggleBtn = page.getByRole('button', {
      name: initialIsDark ? /Switch to light mode/i : /Switch to dark mode/i,
    });
    await toggleBtn.click();

    const afterToggleIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(afterToggleIsDark).toBe(!initialIsDark);

    await page.reload();
    const afterReloadIsDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );
    expect(afterReloadIsDark).toBe(afterToggleIsDark);
  });

  test('2. Cart item removal displays confirmation warning dialog before deleting', async ({
    page,
  }) => {
    const state = createInitialMockState('CUSTOMER');
    state.cart.items = [{ productId: 'aaaa1111-1111-4111-8111-111111111111', quantity: 1 }];
    await installMockApi(page, state);

    await page.goto('/cart');
    await expect(page.getByText('Tactile Mechanical Keyboard')).toBeVisible();

    // Click Remove -> confirmation dialog appears
    await page.getByRole('button', { name: /Remove Tactile Mechanical Keyboard/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/Remove item from cart/i)).toBeVisible();

    // Cancel keeps item in cart
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Tactile Mechanical Keyboard')).toBeVisible();

    // Confirm removes item from cart
    await page.getByRole('button', { name: /Remove Tactile Mechanical Keyboard/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Remove Item/i }).click();
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });

  test('3. Customer deletes an order from Account & Order History with warning dialog', async ({
    page,
  }) => {
    const state = createInitialMockState('CUSTOMER');
    await installMockApi(page, state);

    await page.goto('/account');
    await expect(page.getByText('dddd1111…')).toBeVisible();
    await expect(page.getByText('dddd2222…')).toBeVisible();

    // Click Delete on first order -> ConfirmDialog warning appears
    await page.getByRole('button', { name: 'Delete order dddd1111' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();

    await page.getByRole('dialog').getByRole('button', { name: 'Delete Order' }).click();
    await expect(page.getByRole('cell', { name: 'dddd1111…' })).toBeHidden();
    await expect(page.getByRole('cell', { name: 'dddd2222…' })).toBeVisible();
  });

  test('4. Admin creates, edits, and deletes an order with warning dialog + archives product with warning', async ({
    page,
  }) => {
    const state = createInitialMockState('ADMIN');
    await installMockApi(page, state);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

    // Archive product shows confirmation dialog
    await page.getByRole('button', { name: 'Archive' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Archive Product?' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, Archive Product' }).click();
    await expect(page.getByRole('cell', { name: 'Archived' }).first()).toBeVisible();

    // Switch to Orders tab -> Add Order
    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Add Order' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Full Name').fill('Sam Taylor');
    await page.getByLabel('Address Line 1').fill('742 Evergreen Terrace');
    await page.getByLabel('City').fill('Springfield');
    await page.getByLabel('State / Region').fill('IL');
    await page.getByLabel('US ZIP Code').fill('62704');
    await page.getByRole('dialog').getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByRole('cell', { name: 'Sam Taylor' })).toBeVisible();

    // Edit newly created order -> change status to PAID
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Order Status').selectOption('PAID');
    await page.getByRole('dialog').getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('cell', { name: 'Sam Taylor' })).toBeVisible();

    // Delete order with warning confirmation dialog
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/permanently delete/i)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, Delete Order' }).click();
    await expect(page.getByRole('cell', { name: 'Sam Taylor' })).toBeHidden();
  });

  test('5. Unknown route renders 404 NotFoundPage with link back to catalog', async ({ page }) => {
    const state = createInitialMockState('GUEST');
    await installMockApi(page, state);

    await page.goto('/this-route-does-not-exist');
    await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible();
    await page.getByRole('link', { name: /Return to catalog/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
