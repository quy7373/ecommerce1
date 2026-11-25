const argon2 = require('argon2');
const { config } = require('../../config/env');
const { AppError } = require('../../config/errors');

const MIN_MEMORY_KIB = 19456;
const MIN_TIME_COST = 2;
const MIN_PARALLELISM = 1;

class PasswordService {
  constructor(options = {}) {
    const argonCfg = options.argon2 || config.auth.argon2;
    this.argonOptions = {
      type: argon2.argon2id,
      memoryCost: Math.max(MIN_MEMORY_KIB, argonCfg.memoryCost || MIN_MEMORY_KIB),
      timeCost: Math.max(MIN_TIME_COST, argonCfg.timeCost || MIN_TIME_COST),
      parallelism: Math.max(MIN_PARALLELISM, argonCfg.parallelism || MIN_PARALLELISM),
      saltLength: 16,
      hashLength: 32,
    };
    this.maxConcurrency = Math.max(
      1,
      options.maxConcurrency || config.auth.hashMaxConcurrency || 4
    );
    this.inFlight = 0;
    this._dummyHashPromise = null;
  }

  async _withAdmission(fn) {
    if (this.inFlight >= this.maxConcurrency) {
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Authentication service is temporarily overloaded. Please retry shortly.'
      );
    }
    this.inFlight += 1;
    try {
      return await fn();
    } finally {
      this.inFlight -= 1;
    }
  }

  async getDummyHash() {
    if (!this._dummyHashPromise) {
      this._dummyHashPromise = argon2.hash(
        'dummy-anti-enumeration-password-value-do-not-use',
        this.argonOptions
      );
    }
    return this._dummyHashPromise;
  }

  async hashPassword(nfcPassword) {
    if (typeof nfcPassword !== 'string' || nfcPassword.length === 0) {
      throw new Error('Password must be a non-empty string.');
    }
    return this._withAdmission(() => argon2.hash(nfcPassword, this.argonOptions));
  }

  async verifyPassword(storedHash, candidateNfcPassword) {
    if (typeof storedHash !== 'string' || typeof candidateNfcPassword !== 'string') {
      return false;
    }
    return this._withAdmission(async () => {
      try {
        return await argon2.verify(storedHash, candidateNfcPassword);
      } catch (_) {
        return false;
      }
    });
  }

  async verifyDummy(candidateNfcPassword) {
    const dummyHash = await this.getDummyHash();
    await this.verifyPassword(dummyHash, candidateNfcPassword || 'dummy-candidate-value');
    return false;
  }

  needsRehash(storedHash) {
    if (typeof storedHash !== 'string' || !storedHash.startsWith('$argon2id$')) {
      return true;
    }
    try {
      return argon2.needsRehash(storedHash, this.argonOptions);
    } catch (_) {
      return false;
    }
  }
}

module.exports = {
  PasswordService,
  MIN_MEMORY_KIB,
  MIN_TIME_COST,
  MIN_PARALLELISM,
};
