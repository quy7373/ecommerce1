const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const MAX_MONEY_CENTS = 100_000_000;

/**
 * Formats integer cents to USD currency string without mutating precision.
 */
export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    return '$0.00';
  }
  return usdFormatter.format(cents / 100);
}

/**
 * Parses a dollar string (e.g. "19.99") strictly into integer cents.
 * Returns null if invalid or out of range.
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [wholePart, fracPart = ''] = trimmed.split('.');
  const cents = Number(wholePart) * 100 + Number(fracPart.padEnd(2, '0'));

  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_MONEY_CENTS) {
    return null;
  }
  return cents;
}

export function centsToDollarInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const whole = Math.floor(cents / 100);
  const rem = cents % 100;
  return `${whole}.${String(rem).padStart(2, '0')}`;
}
