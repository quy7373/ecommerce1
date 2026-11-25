require('dotenv').config();
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DUMMYJSON_URL = 'https://dummyjson.com/products?limit=194';

/**
 * Maps DummyJSON category slugs into clean storefront categories.
 * Existing Kanto categories (electronics, home-kitchen, apparel, accessories)
 * are preserved and enriched; new categories are added for broad catalog variety.
 */
const CATEGORY_MAP = {
  'mobile-accessories': { slug: 'electronics', name: 'Electronics' },
  'home-decoration': { slug: 'home-kitchen', name: 'Home & Kitchen' },
  'kitchen-accessories': { slug: 'home-kitchen', name: 'Home & Kitchen' },
  'mens-shirts': { slug: 'apparel', name: 'Apparel' },
  'womens-dresses': { slug: 'apparel', name: 'Apparel' },
  tops: { slug: 'apparel', name: 'Apparel' },
  sunglasses: { slug: 'accessories', name: 'Accessories' },
  'womens-bags': { slug: 'accessories', name: 'Accessories' },
  'womens-jewellery': { slug: 'accessories', name: 'Accessories' },
  smartphones: { slug: 'smartphones', name: 'Smartphones' },
  laptops: { slug: 'laptops', name: 'Laptops' },
  tablets: { slug: 'tablets', name: 'Tablets' },
  furniture: { slug: 'furniture', name: 'Furniture' },
  'mens-shoes': { slug: 'shoes', name: 'Shoes' },
  'womens-shoes': { slug: 'shoes', name: 'Shoes' },
  'mens-watches': { slug: 'watches', name: 'Watches' },
  'womens-watches': { slug: 'watches', name: 'Watches' },
  beauty: { slug: 'beauty-fragrances', name: 'Beauty & Fragrances' },
  fragrances: { slug: 'beauty-fragrances', name: 'Beauty & Fragrances' },
  'skin-care': { slug: 'beauty-fragrances', name: 'Beauty & Fragrances' },
  'sports-accessories': { slug: 'sports', name: 'Sports & Outdoors' },
  groceries: { slug: 'groceries', name: 'Groceries' },
};

function deterministicUuid(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest();
  // Set RFC 4122 v4-compatible version & variant bits
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sanitizeSku(rawSku, externalId) {
  const cleaned = String(rawSku || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return cleaned ? `DJ-${cleaned}` : `DJ-PROD-${externalId}`;
}

async function main() {
  console.log(`Fetching products from ${DUMMYJSON_URL}...`);
  const response = await fetch(DUMMYJSON_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch external catalog: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const remoteProducts = Array.isArray(payload.products) ? payload.products : [];
  if (remoteProducts.length === 0) {
    throw new Error('External API returned no products.');
  }

  // Upsert all target categories first
  const uniqueCategories = new Map();
  for (const target of Object.values(CATEGORY_MAP)) {
    uniqueCategories.set(target.slug, target);
  }

  const categoryIdBySlug = new Map();
  for (const cat of uniqueCategories.values()) {
    const row = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: {
        id: deterministicUuid(`category:${cat.slug}`),
        name: cat.name,
        slug: cat.slug,
      },
    });
    categoryIdBySlug.set(cat.slug, row.id);
  }

  // Filter & prepare products (skip vehicle/motorcycle or invalid entries)
  const perSourceCategoryCount = new Map();
  const MAX_PER_SOURCE_CATEGORY = 6;
  const toUpsert = [];

  for (const item of remoteProducts) {
    const mappedCategory = CATEGORY_MAP[item.category];
    if (!mappedCategory) continue;

    const count = perSourceCategoryCount.get(item.category) || 0;
    if (count >= MAX_PER_SOURCE_CATEGORY) continue;

    const imageUrl =
      typeof item.thumbnail === 'string' && item.thumbnail.startsWith('https://')
        ? item.thumbnail
        : Array.isArray(item.images) && typeof item.images[0] === 'string' && item.images[0].startsWith('https://')
          ? item.images[0]
          : null;
    if (!imageUrl) continue;

    const priceCents = Math.round(Number(item.price) * 100);
    if (!Number.isSafeInteger(priceCents) || priceCents < 100 || priceCents > 500_000) continue;

    const name = String(item.title || '').trim().slice(0, 140);
    if (!name) continue;

    const description = String(item.description || '').trim().slice(0, 1000);
    const stockOnHand = Math.max(8, Math.min(120, Math.round(Number(item.stock) || 25)));
    const sku = sanitizeSku(item.sku, item.id);
    const categoryId = categoryIdBySlug.get(mappedCategory.slug);

    perSourceCategoryCount.set(item.category, count + 1);
    toUpsert.push({
      id: deterministicUuid(`dummyjson:product:${item.id}`),
      categoryId,
      sku,
      name,
      description,
      price: priceCents,
      imageUrl,
      stockOnHand,
      categoryName: mappedCategory.name,
    });
  }

  let upserted = 0;
  for (const prod of toUpsert) {
    await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {
        categoryId: prod.categoryId,
        name: prod.name,
        description: prod.description,
        price: prod.price,
        imageUrl: prod.imageUrl,
        active: true,
      },
      create: {
        id: prod.id,
        categoryId: prod.categoryId,
        sku: prod.sku,
        name: prod.name,
        description: prod.description,
        price: prod.price,
        currency: 'USD',
        imageUrl: prod.imageUrl,
        stockOnHand: prod.stockOnHand,
        stockReserved: 0,
        active: true,
        version: 1,
      },
    });
    upserted += 1;
  }

  const [totalCategories, totalProducts] = await Promise.all([
    prisma.category.count(),
    prisma.product.count({ where: { active: true } }),
  ]);

  console.log(
    JSON.stringify(
      {
        source: 'https://dummyjson.com/products',
        importedProducts: upserted,
        totalCategories,
        totalActiveProducts: totalProducts,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error('External catalog import failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
