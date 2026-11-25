// Versioned local blocklist of common/breached passwords.
// Checked offline only (never sent to third-party services).
// Per docs/api/email-password-auth-contract.md, enforced on password creation/reset only, not on login.

const BLOCKLIST_VERSION = '2026-11-23.1';

const COMMON_PASSWORDS = new Set([
  'password1234567',
  'password12345678',
  'password123456789',
  'password1234567890',
  'passwordpassword',
  'passw0rd1234567',
  'passw0rd12345678',
  '123456789012345',
  '1234567890123456',
  '12345678901234567',
  '123456789012345678',
  '12345678901234567890',
  '000000000000000',
  '0000000000000000',
  '111111111111111',
  '1111111111111111',
  '999999999999999',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaa',
  'qwertyuiopasdfg',
  'qwertyuiopasdfgh',
  'qwertyuiop12345',
  'qwertyuiop123456',
  'qwerty123456789',
  'qwerty1234567890',
  'letmein12345678',
  'letmein123456789',
  'iloveyou1234567',
  'iloveyou12345678',
  'welcome12345678',
  'welcome123456789',
  'admin1234567890',
  'administrator123',
  'correcthorsebatterystaple',
  'correct horse battery staple',
  'thisisapassword',
  'thisismypassword',
  'changeme1234567',
  'changeme12345678',
  'football1234567',
  'baseball1234567',
  'supersecret1234',
  'mysecretpassword',
  'abcdefghijklmno',
  'abcdefghijklmnop',
  'zyxwvutsrqponml',
  'trustno1trustno1',
  'monkey123456789',
  'dragon123456789',
  'sunshine1234567',
  'princess1234567',
  'p@ssw0rd1234567',
  'p@ssword1234567',
  'password!123456',
  'kanto1234567890',
  'ecommerce123456',
]);

function isCommonOrBreachedPassword(nfcPassword) {
  if (typeof nfcPassword !== 'string') return false;
  const lowered = nfcPassword.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) return true;
  // Also reject trivial single-character repetition (e.g., 15+ identical characters)
  const chars = Array.from(nfcPassword);
  if (chars.length > 0 && chars.every((ch) => ch === chars[0])) {
    return true;
  }
  return false;
}

module.exports = {
  BLOCKLIST_VERSION,
  COMMON_PASSWORDS,
  isCommonOrBreachedPassword,
};
