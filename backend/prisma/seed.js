require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

const CATEGORIES = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Electronics', slug: 'electronics' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Home & Kitchen', slug: 'home-kitchen' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Apparel', slug: 'apparel' },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Accessories', slug: 'accessories' },
];

const PRODUCTS = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    categoryId: '10000000-0000-4000-8000-000000000001',
    sku: 'ELEC-HEADPHONES-01',
    name: 'Studio Wireless Headphones',
    description:
      'Over-ear wireless headphones with hybrid active noise cancellation, memory-foam earcups, and 30-hour battery life.',
    price: 19900,
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 25,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    categoryId: '10000000-0000-4000-8000-000000000001',
    sku: 'ELEC-KEYBOARD-01',
    name: 'Mechanical Tactile Keyboard',
    description:
      'Compact 75% mechanical keyboard with CNC anodized aluminum frame, hot-swappable tactile switches, and USB-C connectivity.',
    price: 12900,
    imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 40,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    categoryId: '10000000-0000-4000-8000-000000000002',
    sku: 'HOME-MUG-01',
    name: 'Insulated Ceramic Travel Mug',
    description:
      'Double-walled 16oz vacuum-insulated travel mug with ceramic interior coating designed to preserve coffee aroma.',
    price: 3400,
    imageUrl: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 60,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    categoryId: '10000000-0000-4000-8000-000000000003',
    sku: 'APPR-HOODIE-01',
    name: 'Heavyweight Cotton Hoodie',
    description:
      'Relaxed-fit pullover hoodie crafted from 400gsm organic loopback cotton fleece with structured double-lined hood.',
    price: 7800,
    imageUrl: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 35,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    categoryId: '10000000-0000-4000-8000-000000000004',
    sku: 'ACCS-BACKPACK-01',
    name: 'Everyday Commuter Backpack',
    description:
      'Weather-resistant 22L commuter backpack with suspended 16-inch laptop sleeve, magnetic sternum strap, and quick-access top pocket.',
    price: 9500,
    imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 18,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000006',
    categoryId: '10000000-0000-4000-8000-000000000001',
    sku: 'ELEC-MOUSE-01',
    name: 'Wireless Precision Mouse',
    description:
      'Sculpted ergonomic wireless mouse with machined aluminum scroll wheel, silent switches, and multi-device Bluetooth pairing.',
    price: 8900,
    imageUrl: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 28,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000007',
    categoryId: '10000000-0000-4000-8000-000000000002',
    sku: 'HOME-LAMP-01',
    name: 'Architectural LED Desk Lamp',
    description:
      'Counterbalanced matte-aluminum desk lamp with stepless warm-to-daylight dimming and CRI 95+ glare-free optics.',
    price: 14500,
    imageUrl: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 14,
    active: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000008',
    categoryId: '10000000-0000-4000-8000-000000000004',
    sku: 'ACCS-DESKMAT-01',
    name: 'Merino Wool Desk Mat',
    description:
      'Full-width 900x400mm German merino wool felt desk pad with natural cork underside to anchor keyboard and accessories.',
    price: 4800,
    imageUrl: 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?auto=format&fit=crop&w=900&q=80',
    stockOnHand: 4,
    active: true,
  },
];

const KNOWLEDGE_DOCS = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    documentId: 'shipping-policy',
    title: 'Shipping Policy',
    version: '1.0',
    owner: 'Kanto Store Operations',
    sourcePath: 'docs/ai-knowledge/shipping-policy.md',
    chunks: [
      {
        id: '31000000-0000-4000-8000-000000000001',
        section: 'US Shipping Rates & Addresses',
        ordinal: 1,
        content:
          'Standard US test-market shipping is currently $0.00 in demo mode. Checkout collects a US shipping address (recipient name, address line 1, optional line 2, city, state/region, 5-digit US ZIP or ZIP+4, country US, and optional E.164 phone number).',
      },
      {
        id: '31000000-0000-4000-8000-000000000002',
        section: 'Fulfillment & Address Changes',
        ordinal: 2,
        content:
          'After payment is verified, orders move from PAID to PROCESSING and then SHIPPED by store operators. Shipping addresses cannot be edited after order creation; if your order is still PENDING_PAYMENT, cancel it and place a new order with the corrected address.',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    documentId: 'return-policy',
    title: 'Returns & Cancellations',
    version: '1.0',
    owner: 'Kanto Store Operations',
    sourcePath: 'docs/ai-knowledge/return-policy.md',
    chunks: [
      {
        id: '31000000-0000-4000-8000-000000000003',
        section: 'Pending Order Cancellation',
        ordinal: 1,
        content:
          'You can cancel an order directly from Account & Order History while its status is PENDING_PAYMENT. Cancelling a pending order releases the reserved inventory back to the catalog once confirmed.',
      },
      {
        id: '31000000-0000-4000-8000-000000000004',
        section: 'Paid Orders & Refunds',
        ordinal: 2,
        content:
          'Self-service cancellation and automated refunds are not available in-app once an order is PAID, PROCESSING, or SHIPPED. For return eligibility or refund requests on paid orders, contact store support with your order reference.',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    documentId: 'payment-policy',
    title: 'Payment Policy',
    version: '1.0',
    owner: 'Kanto Store Operations',
    sourcePath: 'docs/ai-knowledge/payment-policy.md',
    chunks: [
      {
        id: '31000000-0000-4000-8000-000000000005',
        section: 'Supported Payment Methods & Currency',
        ordinal: 1,
        content:
          'Kanto accepts card payments securely via hosted Stripe Checkout in USD (test mode). Card numbers and security codes are entered only on Stripe Checkout and are never collected or stored by Kanto.',
      },
      {
        id: '31000000-0000-4000-8000-000000000006',
        section: 'Payment Confirmation',
        ordinal: 2,
        content:
          'An order is marked PAID only after the server verifies the signed Stripe webhook confirmation matching the order amount, currency, and session. Returning to Account & Orders shows the verified server status.',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    documentId: 'ordering-guide',
    title: 'Ordering & Account Guide',
    version: '1.0',
    owner: 'Kanto Store Operations',
    sourcePath: 'docs/ai-knowledge/ordering-guide.md',
    chunks: [
      {
        id: '31000000-0000-4000-8000-000000000007',
        section: 'Signing In & Cart Rules',
        ordinal: 1,
        content:
          'Sign in with Google or register with email and password to manage your cart and orders. Each cart supports up to 50 distinct products with quantities from 1 to 99. Adding items to your cart does not reserve stock; inventory is reserved when you submit an order at checkout.',
      },
      {
        id: '31000000-0000-4000-8000-000000000008',
        section: 'Welcome & Store Support Topics',
        ordinal: 2,
        content:
          'Welcome to Kanto Workspace Goods AI Support (hi, hello, hey, help, support). I can help answer questions about Kanto products and catalog, shipping policy, returns and pending order cancellations, Stripe payment methods, signing in, cart rules, and viewing your orders in Account & Orders. I cannot access private account or order data.',
      },
    ],
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    documentId: 'product-catalog',
    title: 'Product Catalog',
    version: '1.0',
    owner: 'Kanto Store Operations',
    sourcePath: 'docs/ai-knowledge/faq.md',
    chunks: [
      {
        id: '31000000-0000-4000-8000-000000000009',
        section: 'Featured Workspace Goods & Catalog',
        ordinal: 1,
        content:
          'Kanto curates precision workspace goods (catalog, product, products, best, popular, hot, featured, price, buy, recommend, electronics, accessories, apparel, home, kitchen, headphones, keyboard, mouse, lamp, mug, hoodie, backpack, mat) across Electronics, Home & Kitchen, Apparel, and Accessories with exact USD pricing and live stock counts.',
      },
    ],
  },
];

async function main() {
  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: cat,
    });
  }

  for (const prod of PRODUCTS) {
    await prisma.product.upsert({
      where: { sku: prod.sku },
      update: {
        name: prod.name,
        description: prod.description,
        price: prod.price,
        imageUrl: prod.imageUrl,
        categoryId: prod.categoryId,
        active: prod.active,
      },
      create: {
        ...prod,
        currency: 'USD',
        stockReserved: 0,
        version: 1,
      },
    });
  }

  const approvedAt = new Date();
  for (const doc of KNOWLEDGE_DOCS) {
    const combinedText = doc.chunks.map((c) => `${c.section}\n${c.content}`).join('\n\n');
    const contentHash = crypto.createHash('sha256').update(combinedText, 'utf8').digest('hex');

    await prisma.knowledgeDocument.upsert({
      where: {
        documentId_version: {
          documentId: doc.documentId,
          version: doc.version,
        },
      },
      update: {
        title: doc.title,
        status: 'APPROVED',
        owner: doc.owner,
        approvedAt,
        sourcePath: doc.sourcePath,
        contentHash,
      },
      create: {
        id: doc.id,
        documentId: doc.documentId,
        title: doc.title,
        version: doc.version,
        status: 'APPROVED',
        owner: doc.owner,
        approvedAt,
        sourcePath: doc.sourcePath,
        contentHash,
      },
    });

    for (const chunk of doc.chunks) {
      await prisma.knowledgeChunk.upsert({
        where: { id: chunk.id },
        update: {
          section: chunk.section,
          ordinal: chunk.ordinal,
          content: chunk.content,
        },
        create: {
          id: chunk.id,
          documentVersionId: doc.id,
          section: chunk.section,
          ordinal: chunk.ordinal,
          content: chunk.content,
        },
      });
    }
  }

  // Optional synthetic admin bootstrap only when explicitly provided via env
  const bootstrapAdminSub = process.env.BOOTSTRAP_ADMIN_GOOGLE_SUB;
  const bootstrapAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (bootstrapAdminSub && bootstrapAdminEmail) {
    await prisma.user.upsert({
      where: { googleSubject: bootstrapAdminSub },
      update: { role: 'ADMIN' },
      create: {
        id: crypto.randomUUID(),
        googleSubject: bootstrapAdminSub,
        email: bootstrapAdminEmail.trim().toLowerCase(),
        displayName: 'Store Admin',
        role: 'ADMIN',
      },
    });
  }

  console.log('Seed completed: categories and sample products upserted.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
