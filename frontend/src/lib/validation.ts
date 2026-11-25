import { APPROVED_IMAGE_HOSTS } from './env';
import type { Address, ProductWrite } from './types';

export const US_POSTAL_REGEX = /^[0-9]{5}(-[0-9]{4})?$/;
export const E164_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;
export const SKU_REGEX = /^[A-Z0-9_-]{1,64}$/;
export const STRICT_EMAIL_REGEX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isValidEmailAddress(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  return STRICT_EMAIL_REGEX.test(trimmed);
}

export interface PasswordRuleStatus {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  digit: boolean;
  special: boolean;
  valid: boolean;
  firstError: string | null;
}

export function evaluatePasswordPolicy(password: string): PasswordRuleStatus {
  const nfc = password.normalize('NFC');
  const len = Array.from(nfc).length;
  const length = len >= 8 && len <= 128;
  const uppercase = /[A-Z]/.test(nfc);
  const lowercase = /[a-z]/.test(nfc);
  const digit = /[0-9]/.test(nfc);
  const special = /[^A-Za-z0-9\s]/.test(nfc);
  const valid = length && uppercase && lowercase && digit && special;

  let firstError: string | null = null;
  if (!length) firstError = 'Password must be between 8 and 128 characters.';
  else if (!uppercase) firstError = 'Password must include at least one uppercase letter (A-Z).';
  else if (!lowercase) firstError = 'Password must include at least one lowercase letter (a-z).';
  else if (!digit) firstError = 'Password must include at least one number (0-9).';
  else if (!special) firstError = 'Password must include at least one special character (e.g., !@#$%^&*).';

  return { length, uppercase, lowercase, digit, special, valid, firstError };
}

export function isSafeImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== '443') return false;
    if (APPROVED_IMAGE_HOSTS.length > 0) {
      const host = parsed.hostname.toLowerCase();
      const sameOrigin = typeof window !== 'undefined' && host === window.location.hostname.toLowerCase();
      if (!sameOrigin && !APPROVED_IMAGE_HOSTS.includes(host)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function isSafeStripeCheckoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'checkout.stripe.com' || host.endsWith('.stripe.com');
  } catch {
    return false;
  }
}

export function validateShippingAddress(input: {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  phone?: string;
}): { valid: boolean; errors: Record<string, string>; normalized?: Address } {
  const errors: Record<string, string> = {};
  const fullName = input.fullName.trim().normalize('NFC');
  const line1 = input.line1.trim().normalize('NFC');
  const line2 = input.line2?.trim().normalize('NFC') || '';
  const city = input.city.trim().normalize('NFC');
  const region = input.region.trim().normalize('NFC');
  const postalCode = input.postalCode.trim();
  const phone = input.phone?.trim() || '';

  if (fullName.length < 1 || fullName.length > 100) {
    errors.fullName = 'Full name is required (1–100 characters).';
  }
  if (line1.length < 1 || line1.length > 200) {
    errors.line1 = 'Address line 1 is required (1–200 characters).';
  }
  if (line2.length > 200) {
    errors.line2 = 'Address line 2 must be at most 200 characters.';
  }
  if (city.length < 1 || city.length > 100) {
    errors.city = 'City is required (1–100 characters).';
  }
  if (region.length < 1 || region.length > 100) {
    errors.region = 'State / Region is required (1–100 characters).';
  }
  if (!US_POSTAL_REGEX.test(postalCode)) {
    errors.postalCode = 'Use a 5-digit US ZIP code or ZIP+4 (e.g., 94107 or 94107-1234).';
  }
  if (phone && !E164_PHONE_REGEX.test(phone)) {
    errors.phone = 'Phone must be in E.164 format (e.g., +14155550199).';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  const normalized: Address = {
    fullName,
    line1,
    ...(line2 ? { line2 } : {}),
    city,
    region,
    postalCode,
    country: 'US',
    ...(phone ? { phone } : {}),
  };

  return { valid: true, errors: {}, normalized };
}

export function validateProductWrite(input: {
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  priceCents: number | null;
  imageUrl: string;
  stockOnHand: string;
  active: boolean;
}): { valid: boolean; errors: Record<string, string>; normalized?: ProductWrite } {
  const errors: Record<string, string> = {};
  const sku = input.sku.trim().toUpperCase();
  const name = input.name.trim().normalize('NFC');
  const description = input.description.trim().normalize('NFC');
  const categoryId = input.categoryId.trim();
  const imageUrlRaw = input.imageUrl.trim();
  const stockNum = Number(input.stockOnHand);

  if (!SKU_REGEX.test(sku)) {
    errors.sku = 'SKU must be 1–64 uppercase letters, digits, underscores, or hyphens.';
  }
  if (name.length < 1 || name.length > 200) {
    errors.name = 'Name is required (1–200 characters).';
  }
  if (description.length > 5000) {
    errors.description = 'Description must be at most 5000 characters.';
  }
  if (!categoryId) {
    errors.categoryId = 'Please select a category.';
  }
  if (input.priceCents === null || input.priceCents < 1 || input.priceCents > 100_000_000) {
    errors.price = 'Price must be at least $0.01 and at most $1,000,000.00.';
  }
  if (imageUrlRaw && !isSafeImageUrl(imageUrlRaw)) {
    errors.imageUrl = 'Image URL must be a valid HTTPS URL (max 2048 chars, no credentials).';
  }
  if (!/^\d+$/.test(input.stockOnHand.trim()) || !Number.isSafeInteger(stockNum) || stockNum < 0 || stockNum > 1_000_000) {
    errors.stockOnHand = 'Stock on hand must be an integer between 0 and 1,000,000.';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    normalized: {
      sku,
      name,
      description,
      categoryId,
      price: input.priceCents as number,
      imageUrl: imageUrlRaw ? imageUrlRaw : null,
      stockOnHand: stockNum,
      active: input.active,
    },
  };
}

export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
