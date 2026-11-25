const crypto = require('crypto');

function matchesWhere(row, where = {}) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === 'OR' && Array.isArray(cond)) {
      if (!cond.some((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    const val = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(val)) return false;
      if ('not' in cond && val === cond.not) return false;
      if ('gt' in cond && !(val > cond.gt)) return false;
      if ('gte' in cond && !(val >= cond.gte)) return false;
      if ('lt' in cond && !(val < cond.lt)) return false;
      if ('lte' in cond && !(val <= cond.lte)) return false;
      if ('contains' in cond) {
        const hay = String(val || '');
        const needle = String(cond.contains);
        if (cond.mode === 'insensitive') {
          if (!hay.toLowerCase().includes(needle.toLowerCase())) return false;
        } else if (!hay.includes(needle)) {
          return false;
        }
      }
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function applyOrderBy(rows, orderBy) {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  return rows.slice().sort((a, b) => {
    for (const spec of specs) {
      const [field, dir] = Object.entries(spec)[0];
      const av = a[field];
      const bv = b[field];
      if (av === bv) continue;
      const cmp =
        av instanceof Date && bv instanceof Date
          ? av.getTime() - bv.getTime()
          : typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv));
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function createInMemoryPrisma() {
  const db = {
    user: [],
    passwordCredential: [],
    authActionToken: [],
    authMailOutbox: [],
    authSession: [],
    oAuthAttempt: [],
    category: [],
    product: [],
    cart: [],
    cartItem: [],
    order: [],
    orderItem: [],
    inventoryReservation: [],
    payment: [],
    webhookEvent: [],
    idempotencyRecord: [],
    auditLog: [],
    securityAuditOutbox: [],
    knowledgeDocument: [],
    knowledgeChunk: [],
  };

  function hydrate(modelName, row, include) {
    if (!row) return null;
    const copy = { ...row };
    if (!include) return copy;

    if (modelName === 'user' && include.credential) {
      copy.credential = db.passwordCredential.find((c) => c.userId === row.id) || null;
    }
    if (modelName === 'authSession' && include.user) {
      copy.user = db.user.find((u) => u.id === row.userId) || null;
    }
    if (modelName === 'product' && include.category) {
      copy.category = db.category.find((c) => c.id === row.categoryId) || null;
    }
    if (modelName === 'cart' && include.items) {
      copy.items = db.cartItem
        .filter((ci) => ci.cartId === row.id)
        .map((ci) => {
          const ciCopy = { ...ci };
          if (include.items?.include?.product) {
            const p = db.product.find((pr) => pr.id === ci.productId);
            ciCopy.product = hydrate('product', p, include.items.include.product.include);
          }
          return ciCopy;
        });
    }
    if (modelName === 'order') {
      if (include.items) {
        copy.items = db.orderItem.filter((oi) => oi.orderId === row.id).map((oi) => ({ ...oi }));
      }
      if (include.reservations) {
        copy.reservations = db.inventoryReservation
          .filter((r) => r.orderId === row.id)
          .map((r) => ({ ...r }));
      }
    }
    if (modelName === 'knowledgeDocument' && include.chunks) {
      let chunks = db.knowledgeChunk.filter((c) => c.documentVersionId === row.id);
      if (include.chunks?.orderBy) chunks = applyOrderBy(chunks, include.chunks.orderBy);
      copy.chunks = chunks.map((c) => ({ ...c }));
    }
    return copy;
  }

  function makeModel(modelName) {
    return {
      async findUnique({ where, include } = {}) {
        let row = null;
        if (where.userId_method_route_key) {
          const k = where.userId_method_route_key;
          row = db[modelName].find(
            (r) =>
              r.userId === k.userId &&
              r.method === k.method &&
              r.route === k.route &&
              r.key === k.key
          );
        } else {
          row = db[modelName].find((r) => matchesWhere(r, where));
        }
        return hydrate(modelName, row, include);
      },
      async findFirst({ where, include, orderBy } = {}) {
        let rows = db[modelName].filter((r) => matchesWhere(r, where));
        if (orderBy) rows = applyOrderBy(rows, orderBy);
        return hydrate(modelName, rows[0] || null, include);
      },
      async findMany({ where, include, orderBy, skip = 0, take } = {}) {
        let rows = db[modelName].filter((r) => matchesWhere(r, where));
        if (orderBy) rows = applyOrderBy(rows, orderBy);
        if (take !== undefined) rows = rows.slice(skip, skip + take);
        else if (skip) rows = rows.slice(skip);
        return rows.map((r) => hydrate(modelName, r, include));
      },
      async count({ where } = {}) {
        return db[modelName].filter((r) => matchesWhere(r, where)).length;
      },
      async create({ data, include }) {
        const now = new Date();
        const nestedItems = data.items?.create;
        const nestedReservations = data.reservations?.create;
        const cleanData = { ...data };
        delete cleanData.items;
        delete cleanData.reservations;

        const row = {
          id: cleanData.id || crypto.randomUUID(),
          createdAt: cleanData.createdAt || now,
          updatedAt: cleanData.updatedAt || now,
          ...cleanData,
        };
        if (modelName === 'user') {
          if (row.googleSubject === undefined) row.googleSubject = null;
          if (row.emailVerifiedAt === undefined) row.emailVerifiedAt = null;
          if (db.user.some((u) => u.email === row.email)) {
            const err = new Error('Unique constraint failed on User.email');
            err.code = 'P2002';
            throw err;
          }
          if (row.googleSubject && db.user.some((u) => u.googleSubject === row.googleSubject)) {
            const err = new Error('Unique constraint failed on User.googleSubject');
            err.code = 'P2002';
            throw err;
          }
        }
        if (modelName === 'passwordCredential') {
          if (row.version === undefined) row.version = 1;
          if (row.passwordChangedAt === undefined) row.passwordChangedAt = now;
        }
        if (modelName === 'authActionToken') {
          if (row.userId === undefined) row.userId = null;
          if (row.credentialVersion === undefined) row.credentialVersion = null;
          if (row.consumedAt === undefined) row.consumedAt = null;
        }
        if (modelName === 'authMailOutbox') {
          if (row.status === undefined) row.status = 'PENDING';
          if (row.attempts === undefined) row.attempts = 0;
          if (row.nextAttemptAt === undefined) row.nextAttemptAt = now;
          if (row.claimUntil === undefined) row.claimUntil = null;
          if (row.sentAt === undefined) row.sentAt = null;
          if (row.lastErrorCode === undefined) row.lastErrorCode = null;
        }
        if (modelName === 'authSession' && row.revokedAt === undefined) row.revokedAt = null;
        if (modelName === 'oAuthAttempt' && row.consumedAt === undefined) row.consumedAt = null;
        if (modelName === 'order') {
          if (row.stripeSessionId === undefined) row.stripeSessionId = null;
          if (row.checkoutClaimUntil === undefined) row.checkoutClaimUntil = null;
          if (row.checkoutFirstAttemptAt === undefined) row.checkoutFirstAttemptAt = null;
          if (row.checkoutRequestedExpiresAt === undefined) row.checkoutRequestedExpiresAt = null;
          if (row.cancellationRequestedAt === undefined) row.cancellationRequestedAt = null;
          if (row.paidAt === undefined) row.paidAt = null;
        }
        if (modelName === 'webhookEvent') {
          if (row.receivedAt === undefined) row.receivedAt = now;
          if (row.nextAttemptAt === undefined) row.nextAttemptAt = now;
          if (row.attempts === undefined) row.attempts = 0;
        }

        db[modelName].push(row);

        if (modelName === 'order' && Array.isArray(nestedItems)) {
          for (const oi of nestedItems) {
            db.orderItem.push({ ...oi, orderId: row.id });
          }
        }
        if (modelName === 'order' && Array.isArray(nestedReservations)) {
          for (const rv of nestedReservations) {
            db.inventoryReservation.push({ ...rv, orderId: row.id, resolvedAt: null, createdAt: now });
          }
        }

        return hydrate(modelName, row, include);
      },
      async update({ where, data, include }) {
        const idx = db[modelName].findIndex((r) => matchesWhere(r, where));
        if (idx === -1) {
          const err = new Error('Record not found');
          err.code = 'P2025';
          throw err;
        }
        db[modelName][idx] = {
          ...db[modelName][idx],
          ...data,
          updatedAt: new Date(),
        };
        return hydrate(modelName, db[modelName][idx], include);
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (let i = 0; i < db[modelName].length; i += 1) {
          if (matchesWhere(db[modelName][i], where)) {
            db[modelName][i] = { ...db[modelName][i], ...data, updatedAt: new Date() };
            count += 1;
          }
        }
        return { count };
      },
      async delete({ where }) {
        const idx = db[modelName].findIndex((r) => matchesWhere(r, where));
        if (idx === -1) {
          const err = new Error('Record not found');
          err.code = 'P2025';
          throw err;
        }
        const [removed] = db[modelName].splice(idx, 1);
        return removed;
      },
      async deleteMany({ where } = {}) {
        const before = db[modelName].length;
        db[modelName] = db[modelName].filter((r) => !matchesWhere(r, where));
        return { count: before - db[modelName].length };
      },
    };
  }

  const client = {
    _db: db,
    $queryRaw: async () => [{ '?column?': 1 }],
    $disconnect: async () => {},
  };

  for (const name of Object.keys(db)) {
    client[name] = makeModel(name);
  }

  client.$transaction = async (fn) => fn(client);
  return client;
}

module.exports = { createInMemoryPrisma };
