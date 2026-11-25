const { validationError } = require('../../config/errors');
const {
  UUID_REGEX,
  normalizeText,
  codePointLength,
  parseQueryInt,
} = require('../../middleware/validate');

const ALLOWED_SORTS = new Set(['newest', 'price_asc', 'price_desc', 'name_asc']);

function parseCatalogQuery(rawQuery, { allowActiveFilter = false } = {}) {
  const allowedKeys = new Set([
    'q',
    'categoryId',
    'minPrice',
    'maxPrice',
    'inStock',
    'sort',
    'page',
    'pageSize',
    ...(allowActiveFilter ? ['active'] : []),
  ]);

  const details = [];
  for (const key of Object.keys(rawQuery || {})) {
    if (!allowedKeys.has(key)) {
      details.push({
        field: `query.${key}`,
        code: 'UNKNOWN_FIELD',
        message: 'Unknown query parameter.',
      });
    }
  }

  let q = undefined;
  if (rawQuery.q !== undefined) {
    if (typeof rawQuery.q !== 'string') {
      details.push({ field: 'query.q', code: 'TYPE', message: 'q must be a string.' });
    } else {
      const normalized = normalizeText(rawQuery.q);
      const len = codePointLength(normalized);
      if (len < 1 || len > 100) {
        details.push({ field: 'query.q', code: 'RANGE', message: 'q must be 1..100 characters.' });
      } else {
        q = normalized;
      }
    }
  }

  let categoryId = undefined;
  if (rawQuery.categoryId !== undefined) {
    if (typeof rawQuery.categoryId !== 'string' || !UUID_REGEX.test(rawQuery.categoryId)) {
      details.push({
        field: 'query.categoryId',
        code: 'FORMAT',
        message: 'categoryId must be a valid UUID.',
      });
    } else {
      categoryId = rawQuery.categoryId;
    }
  }

  let minPrice = undefined;
  if (rawQuery.minPrice !== undefined) {
    const parsed = parseQueryInt(rawQuery.minPrice, 'minPrice', 0, 100_000_000);
    if (parsed.error) details.push(parsed.error);
    else minPrice = parsed.value;
  }

  let maxPrice = undefined;
  if (rawQuery.maxPrice !== undefined) {
    const parsed = parseQueryInt(rawQuery.maxPrice, 'maxPrice', 0, 100_000_000);
    if (parsed.error) details.push(parsed.error);
    else maxPrice = parsed.value;
  }

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    details.push({
      field: 'query.minPrice',
      code: 'RANGE',
      message: 'minPrice cannot exceed maxPrice.',
    });
  }

  let inStock = undefined;
  if (rawQuery.inStock !== undefined) {
    if (rawQuery.inStock === 'true') inStock = true;
    else if (rawQuery.inStock === 'false') inStock = false;
    else {
      details.push({
        field: 'query.inStock',
        code: 'FORMAT',
        message: 'inStock must be exactly true or false.',
      });
    }
  }

  let active = undefined;
  if (allowActiveFilter && rawQuery.active !== undefined) {
    if (rawQuery.active === 'true') active = true;
    else if (rawQuery.active === 'false') active = false;
    else {
      details.push({
        field: 'query.active',
        code: 'FORMAT',
        message: 'active must be exactly true or false.',
      });
    }
  }

  let sort = 'newest';
  if (rawQuery.sort !== undefined) {
    if (typeof rawQuery.sort !== 'string' || !ALLOWED_SORTS.has(rawQuery.sort)) {
      details.push({
        field: 'query.sort',
        code: 'FORMAT',
        message: 'sort must be one of newest, price_asc, price_desc, name_asc.',
      });
    } else {
      sort = rawQuery.sort;
    }
  }

  let page = 1;
  if (rawQuery.page !== undefined) {
    const parsed = parseQueryInt(rawQuery.page, 'page', 1, 100_000);
    if (parsed.error) details.push(parsed.error);
    else page = parsed.value;
  }

  let pageSize = 20;
  if (rawQuery.pageSize !== undefined) {
    const parsed = parseQueryInt(rawQuery.pageSize, 'pageSize', 1, 100);
    if (parsed.error) details.push(parsed.error);
    else pageSize = parsed.value;
  }

  if (details.length > 0) {
    throw validationError(details);
  }

  return {
    q,
    categoryId,
    minPrice,
    maxPrice,
    inStock,
    active,
    sort,
    page,
    pageSize,
  };
}

module.exports = {
  parseCatalogQuery,
};
