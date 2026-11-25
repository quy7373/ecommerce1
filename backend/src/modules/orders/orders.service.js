const crypto = require('crypto');
const { AppError } = require('../../config/errors');
const { encryptEnvelope, decryptEnvelope } = require('../../config/crypto');
const { runSerializableTransaction } = require('../../config/prisma');

const MAX_ORDER_MONEY = 100_000_000;
const MAX_PENDING_ORDERS_PER_USER = 3;
const RESERVATION_TTL_MS = 30 * 60 * 1000;

function decryptOrderAddress(order) {
  if (!order.shippingAddress) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Order shipping address integrity error.');
  }
  const plaintext = decryptEnvelope(order.shippingAddress, {
    entity: 'Order',
    rowId: order.id,
    field: 'shippingAddress',
  });
  return JSON.parse(plaintext);
}

function toOrderDto(order) {
  const shippingAddress = decryptOrderAddress(order);
  return {
    id: order.id,
    status: order.status,
    items: (order.items || []).map((item) => ({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
    shippingAddress,
    subtotal: order.subtotal,
    shippingTotal: order.shippingTotal,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    currency: 'USD',
    createdAt: new Date(order.createdAt).toISOString(),
    updatedAt: new Date(order.updatedAt).toISOString(),
    reservationExpiresAt: new Date(order.reservationExpiresAt).toISOString(),
    paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
    cancellationRequestedAt: order.cancellationRequestedAt
      ? new Date(order.cancellationRequestedAt).toISOString()
      : null,
    version: order.version,
  };
}

class OrdersService {
  constructor(prisma, { idempotencyService, stripeClient, onOrderAlreadyPaid = null }) {
    this.prisma = prisma;
    this.idempotencyService = idempotencyService;
    this.stripeClient = stripeClient;
    this.onOrderAlreadyPaid = onOrderAlreadyPaid;
  }

  async listOrders({ userId, page = 1, pageSize = 20, status }) {
    const where = {};
    if (userId) where.userId = userId;
    if (status) where.status = status;

    const [totalItems, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: { items: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
    return {
      data: rows.map(toOrderDto),
      pagination: { page, pageSize, totalItems, totalPages },
    };
  }

  async getOrder({ orderId, userId }) {
    const where = userId ? { id: orderId, userId } : { id: orderId };
    const order = await this.prisma.order.findFirst({
      where,
      include: { items: true },
    });
    if (!order) {
      throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    }
    return toOrderDto(order);
  }

  async createOrder({ userId, idempotencyKey, cartVersion, shippingAddress }) {
    return this.idempotencyService.execute({
      userId,
      method: 'POST',
      route: '/api/v1/orders',
      key: idempotencyKey,
      body: { cartVersion, shippingAddress },
      handler: async () => {
        const orderDto = await runSerializableTransaction(this.prisma, async (tx) => {
          const now = new Date();
          const activePendingCount = await tx.order.count({
            where: {
              userId,
              status: 'PENDING_PAYMENT',
              reservationExpiresAt: { gt: now },
            },
          });
          if (activePendingCount >= MAX_PENDING_ORDERS_PER_USER) {
            throw new AppError(
              409,
              'ORDER_LIMIT_EXCEEDED',
              'Maximum of 3 active pending orders reached.'
            );
          }

          const cart = await tx.cart.findUnique({
            where: { userId },
            include: { items: true },
          });
          if (!cart || cart.items.length === 0) {
            throw new AppError(409, 'CART_EMPTY', 'Cart is empty.');
          }
          if (cart.version !== cartVersion) {
            throw new AppError(409, 'VERSION_CONFLICT', 'Cart version mismatch. Please refresh cart.');
          }

          const existingPendingForCart = await tx.order.findFirst({
            where: {
              cartId: cart.id,
              cartVersion: cart.version,
              status: 'PENDING_PAYMENT',
              reservationExpiresAt: { gt: now },
            },
          });
          if (existingPendingForCart) {
            throw new AppError(
              409,
              'ORDER_ALREADY_PENDING',
              'An active pending order already exists for this cart version.'
            );
          }

          // Fetch all referenced products in a single query (eliminates N+1 round-trips)
          const sortedItems = cart.items.slice().sort((a, b) => a.productId.localeCompare(b.productId));
          const productIds = sortedItems.map((i) => i.productId);
          const products = await tx.product.findMany({
            where: { id: { in: productIds } },
          });
          const productById = new Map(products.map((p) => [p.id, p]));
          const orderItemsData = [];
          let subtotal = 0;

          for (const item of sortedItems) {
            const product = productById.get(item.productId);
            if (!product || !product.active) {
              throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'One or more cart products are unavailable.');
            }
            const available = product.stockOnHand - product.stockReserved;
            if (item.quantity > available) {
              throw new AppError(409, 'OUT_OF_STOCK', 'Insufficient stock for one or more products.');
            }

            const lineTotal = product.price * item.quantity;
            if (!Number.isSafeInteger(lineTotal) || lineTotal > MAX_ORDER_MONEY) {
              throw new AppError(409, 'TOTAL_LIMIT_EXCEEDED', 'Order line total exceeds allowed limit.');
            }
            subtotal += lineTotal;
            if (!Number.isSafeInteger(subtotal) || subtotal > MAX_ORDER_MONEY) {
              throw new AppError(409, 'TOTAL_LIMIT_EXCEEDED', 'Order total exceeds allowed limit.');
            }

            orderItemsData.push({
              id: crypto.randomUUID(),
              productId: product.id,
              sku: product.sku,
              name: product.name,
              unitPrice: product.price,
              quantity: item.quantity,
              lineTotal,
              currentStockReserved: product.stockReserved,
              currentVersion: product.version,
            });
          }

          const orderId = crypto.randomUUID();
          const reservationExpiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);

          const encryptedAddress = encryptEnvelope(shippingAddress, {
            entity: 'Order',
            rowId: orderId,
            field: 'shippingAddress',
          });

          for (const oi of orderItemsData) {
            await tx.product.update({
              where: { id: oi.productId },
              data: {
                stockReserved: oi.currentStockReserved + oi.quantity,
                version: oi.currentVersion + 1,
              },
            });
          }

          const createdOrder = await tx.order.create({
            data: {
              id: orderId,
              userId,
              cartId: cart.id,
              cartVersion: cart.version,
              status: 'PENDING_PAYMENT',
              shippingAddress: encryptedAddress,
              subtotal,
              shippingTotal: 0,
              taxTotal: 0,
              grandTotal: subtotal,
              currency: 'USD',
              reservationExpiresAt,
              checkoutState: 'NOT_STARTED',
              version: 1,
              items: {
                create: orderItemsData.map((oi) => ({
                  id: oi.id,
                  productId: oi.productId,
                  sku: oi.sku,
                  name: oi.name,
                  unitPrice: oi.unitPrice,
                  quantity: oi.quantity,
                  lineTotal: oi.lineTotal,
                })),
              },
              reservations: {
                create: orderItemsData.map((oi) => ({
                  id: crypto.randomUUID(),
                  productId: oi.productId,
                  quantity: oi.quantity,
                  status: 'ACTIVE',
                  expiresAt: reservationExpiresAt,
                })),
              },
            },
            include: { items: true },
          });

          return toOrderDto(createdOrder);
        });

        return {
          status: 201,
          body: { data: orderDto },
          resourceId: orderDto.id,
        };
      },
    });
  }

  async releaseReservationsAndCancelOrder(tx, orderId, targetStatus = 'CANCELLED') {
    const now = new Date();
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, reservations: true },
    });
    if (!order || order.status !== 'PENDING_PAYMENT') {
      return order;
    }

    const activeReservations = (order.reservations || [])
      .filter((r) => r.status === 'ACTIVE')
      .sort((a, b) => a.productId.localeCompare(b.productId));

    for (const resv of activeReservations) {
      await tx.inventoryReservation.update({
        where: { id: resv.id },
        data: { status: 'RELEASED', resolvedAt: now },
      });
      const product = await tx.product.findUnique({ where: { id: resv.productId } });
      if (product) {
        await tx.product.update({
          where: { id: product.id },
          data: {
            stockReserved: Math.max(0, product.stockReserved - resv.quantity),
            version: product.version + 1,
          },
        });
      }
    }

    return tx.order.update({
      where: { id: orderId },
      data: {
        status: targetStatus,
        checkoutState: 'CLOSED',
        version: order.version + 1,
      },
      include: { items: true },
    });
  }

  async cancelOrder({ orderId, userId }) {
    // Phase 1: Atomically check ownership, state, and record cancellation intent
    const prep = await runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        include: { items: true, reservations: true },
      });
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      }
      if (order.status === 'CANCELLED') {
        return { immediate: true, statusCode: 200, pending: false, order };
      }
      if (order.status !== 'PENDING_PAYMENT') {
        throw new AppError(
          409,
          'ORDER_NOT_CANCELLABLE',
          `Order in status ${order.status} cannot be cancelled.`
        );
      }

      const now = new Date();
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          cancellationRequestedAt: order.cancellationRequestedAt || now,
        },
        include: { items: true, reservations: true },
      });

      // If Checkout was never started, cancel immediately and release stock in the same tx
      if (updated.checkoutState === 'NOT_STARTED' && !updated.stripeSessionId) {
        const cancelled = await this.releaseReservationsAndCancelOrder(tx, updated.id, 'CANCELLED');
        return { immediate: true, statusCode: 200, pending: false, order: cancelled };
      }

      return { immediate: false, order: updated };
    });

    if (prep.immediate) {
      return {
        statusCode: prep.statusCode,
        data: { order: toOrderDto(prep.order), pending: prep.pending },
      };
    }

    // Phase 2: Confirm/expire Stripe session outside SQL locks
    const order = prep.order;
    if (!order.stripeSessionId) {
      // Session creation in flight; worker will reconcile
      return {
        statusCode: 202,
        data: { order: toOrderDto(order), pending: true },
      };
    }

    try {
      const remoteSession = await this.stripeClient.retrieveCheckoutSession(order.stripeSessionId);
      if (remoteSession.payment_status === 'paid') {
        if (typeof this.onOrderAlreadyPaid === 'function') {
          await this.onOrderAlreadyPaid(order.id, remoteSession).catch(() => {});
        }
        throw new AppError(
          409,
          'ORDER_NOT_CANCELLABLE',
          'Payment already completed for this order. Your order status has been synced to Paid.'
        );
      }
      if (remoteSession.status === 'open') {
        await this.stripeClient.expireCheckoutSession(order.stripeSessionId);
      }

      const cancelled = await runSerializableTransaction(this.prisma, async (tx) => {
        return this.releaseReservationsAndCancelOrder(tx, order.id, 'CANCELLED');
      });

      return {
        statusCode: 200,
        data: { order: toOrderDto(cancelled), pending: false },
      };
    } catch (err) {
      if (err instanceof AppError && err.code === 'ORDER_NOT_CANCELLABLE') {
        throw err;
      }
      // Unknown provider outcome: keep reservation held and return 202 pending=true
      return {
        statusCode: 202,
        data: { order: toOrderDto(order), pending: true },
      };
    }
  }

  async deleteOrder({ orderId, userId }) {
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, status: true, stripeSessionId: true },
    });
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    }

    // Best-effort expire open Stripe checkout session before deleting pending order
    if (existing.status === 'PENDING_PAYMENT' && existing.stripeSessionId && this.stripeClient) {
      try {
        const remoteSession = await this.stripeClient.retrieveCheckoutSession(existing.stripeSessionId);
        if (remoteSession && remoteSession.status === 'open') {
          await this.stripeClient.expireCheckoutSession(existing.stripeSessionId);
        }
      } catch {
        // Proceed with local deletion even if Stripe session is already expired/unreachable
      }
    }

    await runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        include: { reservations: true },
      });
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      }

      const activeReservations = (order.reservations || [])
        .filter((r) => r.status === 'ACTIVE')
        .sort((a, b) => a.productId.localeCompare(b.productId));
      for (const resv of activeReservations) {
        const product = await tx.product.findUnique({ where: { id: resv.productId } });
        if (product) {
          await tx.product.update({
            where: { id: product.id },
            data: {
              stockReserved: Math.max(0, product.stockReserved - resv.quantity),
              version: product.version + 1,
            },
          });
        }
      }

      await tx.webhookEvent.updateMany({
        where: { orderId: order.id },
        data: { orderId: null },
      });
      await tx.payment.deleteMany({ where: { orderId: order.id } });
      await tx.inventoryReservation.deleteMany({ where: { orderId: order.id } });
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      await tx.order.delete({ where: { id: order.id } });
    });
  }
}

module.exports = {
  OrdersService,
  toOrderDto,
  decryptOrderAddress,
};
