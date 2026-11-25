const { CartService } = require('../../src/modules/cart/cart.service');
const { PaymentsService } = require('../../src/modules/payments/payments.service');
const { AdminService } = require('../../src/modules/admin/admin.service');
const { IdempotencyService } = require('../../src/modules/orders/idempotency.service');

describe('Unit: Backend Logic Fixes (Cart, Payments, Idempotency, Admin)', () => {
  it('CartService.ensureCart recovers cleanly from concurrent P2002 unique creation race', async () => {
    const existingCart = { id: 'cart-1', userId: 'user-1', version: 1, items: [] };
    let findCalls = 0;
    const tx = {
      cart: {
        findUnique: jest.fn(async () => {
          findCalls += 1;
          return findCalls === 1 ? null : existingCart;
        }),
        create: jest.fn(async () => {
          const err = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }),
      },
    };

    const cartService = new CartService(tx);
    const result = await cartService.ensureCart(tx, 'user-1');
    expect(result).toBe(existingCart);
    expect(tx.cart.create).toHaveBeenCalledTimes(1);
    expect(tx.cart.findUnique).toHaveBeenCalledTimes(2);
  });

  it('PaymentsService.createCheckoutSession releases CREATING claim if Stripe throws', async () => {
    const order = {
      id: 'ord-1',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      grandTotal: 5000,
      cancellationRequestedAt: null,
      reservationExpiresAt: new Date(Date.now() + 60_000),
      checkoutState: 'NOT_STARTED',
      stripeSessionId: null,
      items: [],
    };
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      order: {
        findFirst: jest.fn(async () => order),
        update: jest.fn(async ({ data }) => ({ ...order, ...data })),
        updateMany,
      },
    };
    const idempotencyService = {
      execute: async ({ handler }) => handler(),
    };
    const stripeClient = {
      createCheckoutSession: jest.fn(async () => {
        throw new Error('Stripe network timeout');
      }),
    };

    const paymentsService = new PaymentsService(prisma, {
      idempotencyService,
      stripeClient,
      ordersService: {},
    });

    await expect(
      paymentsService.createCheckoutSession({
        userId: 'user-1',
        orderId: 'ord-1',
        idempotencyKey: 'key_1234567890',
      })
    ).rejects.toThrow('Stripe network timeout');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ord-1',
        checkoutState: 'CREATING',
        stripeSessionId: null,
      },
      data: {
        checkoutState: 'NOT_STARTED',
        checkoutClaimUntil: null,
      },
    });
  });

  it('PaymentsService.createCheckoutSession rejects reusing an expired Stripe session with 409', async () => {
    const order = {
      id: 'ord-2',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      grandTotal: 5000,
      cancellationRequestedAt: null,
      reservationExpiresAt: new Date(Date.now() + 60_000),
      checkoutState: 'READY',
      stripeSessionId: 'cs_test_expired',
      items: [],
    };
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      order: {
        findFirst: jest.fn(async () => order),
      },
    };
    const paymentsService = new PaymentsService(prisma, {
      idempotencyService: { execute: async ({ handler }) => handler() },
      stripeClient: {
        retrieveCheckoutSession: jest.fn(async () => ({
          id: 'cs_test_expired',
          status: 'expired',
          payment_status: 'unpaid',
          url: null,
        })),
      },
      ordersService: {},
    });

    await expect(
      paymentsService.createCheckoutSession({
        userId: 'user-1',
        orderId: 'ord-2',
        idempotencyKey: 'key_reuse_1234',
      })
    ).rejects.toMatchObject({ status: 409, code: 'ORDER_NOT_PAYABLE' });
  });

  it('AdminService.archiveProduct is idempotent when product is already archived', async () => {
    const product = { id: 'prod-1', version: 2, active: false };
    const update = jest.fn();
    const auditCreate = jest.fn();
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      product: {
        findUnique: jest.fn(async () => product),
        update,
      },
      auditLog: { create: auditCreate },
    };

    const adminService = new AdminService(prisma, {
      productsRepository: {},
      ordersService: {},
    });
    await adminService.archiveProduct({
      productId: 'prod-1',
      version: 2,
      actorId: 'admin-1',
      requestId: 'req-1',
    });

    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('IdempotencyService rejects concurrent reclaim of expired IN_PROGRESS lease when updateMany returns 0', async () => {
    const existing = {
      id: 'idemp-1',
      requestHash: 'dummy',
      status: 'IN_PROGRESS',
      claimUntil: new Date(Date.now() - 5000),
      responseBody: null,
    };
    const prisma = {
      idempotencyRecord: {
        findUnique: jest.fn(async () => existing),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const idemp = new IdempotencyService(prisma);
    // Compute exact hash for { a: 1 }
    const { sha256Hex, canonicalizeJson } = require('../../src/config/crypto');
    existing.requestHash = sha256Hex(canonicalizeJson({ a: 1 }));

    await expect(
      idemp.execute({
        userId: 'u1',
        method: 'POST',
        route: '/api/v1/orders',
        key: 'k1',
        body: { a: 1 },
        handler: jest.fn(),
      })
    ).rejects.toMatchObject({ status: 409, code: 'REQUEST_IN_PROGRESS' });
  });

  it('OrdersService.deleteOrder releases active reservations and deletes owned order', async () => {
    const { OrdersService } = require('../../src/modules/orders/orders.service');
    const order = {
      id: 'ord-1',
      userId: 'user-1',
      status: 'PENDING_PAYMENT',
      stripeSessionId: 'cs_test_1',
      reservations: [{ id: 'res-1', productId: 'prod-1', quantity: 2, status: 'ACTIVE' }],
    };
    const productUpdate = jest.fn(async () => ({}));
    const webhookUpdateMany = jest.fn(async () => ({ count: 1 }));
    const paymentDeleteMany = jest.fn(async () => ({ count: 0 }));
    const reservationDeleteMany = jest.fn(async () => ({ count: 1 }));
    const itemDeleteMany = jest.fn(async () => ({ count: 1 }));
    const orderDelete = jest.fn(async () => ({ id: 'ord-1' }));
    const prisma = {
      $transaction: async (fn) => fn(prisma),
      order: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === 'ord-1' && where.userId === 'user-1' ? order : null
        ),
        delete: orderDelete,
      },
      product: {
        findUnique: jest.fn(async () => ({ id: 'prod-1', stockReserved: 5, version: 3 })),
        update: productUpdate,
      },
      webhookEvent: { updateMany: webhookUpdateMany },
      payment: { deleteMany: paymentDeleteMany },
      inventoryReservation: { deleteMany: reservationDeleteMany },
      orderItem: { deleteMany: itemDeleteMany },
    };
    const stripeClient = {
      retrieveCheckoutSession: jest.fn(async () => ({ status: 'open' })),
      expireCheckoutSession: jest.fn(async () => ({})),
    };

    const service = new OrdersService(prisma, { idempotencyService: {}, stripeClient });
    await service.deleteOrder({ orderId: 'ord-1', userId: 'user-1' });

    expect(stripeClient.expireCheckoutSession).toHaveBeenCalledWith('cs_test_1');
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { stockReserved: 3, version: 4 },
    });
    expect(webhookUpdateMany).toHaveBeenCalledWith({
      where: { orderId: 'ord-1' },
      data: { orderId: null },
    });
    expect(paymentDeleteMany).toHaveBeenCalledWith({ where: { orderId: 'ord-1' } });
    expect(reservationDeleteMany).toHaveBeenCalledWith({ where: { orderId: 'ord-1' } });
    expect(itemDeleteMany).toHaveBeenCalledWith({ where: { orderId: 'ord-1' } });
    expect(orderDelete).toHaveBeenCalledWith({ where: { id: 'ord-1' } });

    await expect(
      service.deleteOrder({ orderId: 'ord-1', userId: 'other-user' })
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
