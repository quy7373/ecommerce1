const crypto = require('crypto');
const { AppError } = require('../../config/errors');
const { runSerializableTransaction } = require('../../config/prisma');

const THIRTY_ONE_MIN_MS = 31 * 60 * 1000;
const CLAIM_LEASE_MS = 30 * 1000;
const SUPPORTED_WEBHOOK_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

class PaymentsService {
  constructor(prisma, { idempotencyService, stripeClient, ordersService }) {
    this.prisma = prisma;
    this.idempotencyService = idempotencyService;
    this.stripeClient = stripeClient;
    this.ordersService = ordersService;
  }

  async createCheckoutSession({ userId, orderId, idempotencyKey }) {
    return this.idempotencyService.execute({
      userId,
      method: 'POST',
      route: '/api/v1/checkout/sessions',
      key: idempotencyKey,
      body: { orderId },
      handler: async () => {
        const now = new Date();

        // Phase 1: Atomically validate and claim order for Checkout creation
        const claim = await runSerializableTransaction(this.prisma, async (tx) => {
          const order = await tx.order.findFirst({
            where: { id: orderId, userId },
            include: { items: true },
          });
          if (!order) {
            throw new AppError(404, 'NOT_FOUND', 'Order not found.');
          }
          if (order.grandTotal <= 0) {
            throw new AppError(409, 'CHECKOUT_EMPTY', 'Cannot create checkout session for zero total.');
          }
          if (
            order.status !== 'PENDING_PAYMENT' ||
            order.cancellationRequestedAt !== null ||
            new Date(order.reservationExpiresAt) <= now
          ) {
            throw new AppError(409, 'ORDER_NOT_PAYABLE', 'Order is not eligible for payment.');
          }

          // Existing ready session: return it under 200
          if (order.stripeSessionId && order.checkoutState === 'READY') {
            return { reuseExisting: true, order };
          }

          if (
            order.checkoutState === 'CREATING' &&
            order.checkoutClaimUntil &&
            new Date(order.checkoutClaimUntil) > now
          ) {
            throw new AppError(
              409,
              'REQUEST_IN_PROGRESS',
              'Checkout session creation is already in progress.',
              [],
              { 'Retry-After': '1' }
            );
          }

          const firstAttemptAt = order.checkoutFirstAttemptAt || now;
          const requestedExpiresAt =
            order.checkoutRequestedExpiresAt || new Date(firstAttemptAt.getTime() + THIRTY_ONE_MIN_MS);

          const updated = await tx.order.update({
            where: { id: order.id },
            data: {
              checkoutState: 'CREATING',
              checkoutClaimUntil: new Date(now.getTime() + CLAIM_LEASE_MS),
              checkoutFirstAttemptAt: firstAttemptAt,
              checkoutRequestedExpiresAt: requestedExpiresAt,
            },
            include: { items: true },
          });

          return { reuseExisting: false, order: updated };
        });

        // Reuse existing Stripe session if already created
        if (claim.reuseExisting) {
          const remote = await this.stripeClient.retrieveCheckoutSession(claim.order.stripeSessionId);
          if (remote.payment_status === 'paid' || remote.status === 'complete') {
            throw new AppError(409, 'ORDER_NOT_PAYABLE', 'Order has already been paid.');
          }
          if (remote.status !== 'open' || !remote.url) {
            throw new AppError(
              409,
              'ORDER_NOT_PAYABLE',
              'Checkout session has expired and can no longer be resumed.'
            );
          }
          return {
            status: 200,
            resourceId: claim.order.id,
            body: {
              data: {
                orderId: claim.order.id,
                sessionId: remote.id,
                checkoutUrl: remote.url,
                expiresAt: new Date(remote.expires_at * 1000).toISOString(),
              },
            },
          };
        }

        // Phase 2: Call Stripe outside SQL locks with deterministic provider key & frozen expiry
        const order = claim.order;
        const providerIdempotencyKey = `checkout:${order.id}:1`;
        const expiresAtUnix = Math.floor(new Date(order.checkoutRequestedExpiresAt).getTime() / 1000);

        let stripeSession;
        try {
          stripeSession = await this.stripeClient.createCheckoutSession({
            order,
            expiresAtUnix,
            idempotencyKey: providerIdempotencyKey,
          });
        } catch (err) {
          // Release transient CREATING claim so user can retry immediately if Stripe failed before session creation
          await this.prisma.order
            .updateMany({
              where: {
                id: order.id,
                checkoutState: 'CREATING',
                stripeSessionId: null,
              },
              data: {
                checkoutState: 'NOT_STARTED',
                checkoutClaimUntil: null,
              },
            })
            .catch(() => {});
          throw err;
        }

        // Phase 3: Persist session ID and align reservation expiry atomically
        await runSerializableTransaction(this.prisma, async (tx) => {
          const alignedExpiry = stripeSession.expiresAt;
          await tx.order.update({
            where: { id: order.id },
            data: {
              stripeSessionId: stripeSession.id,
              checkoutState: 'READY',
              checkoutClaimUntil: null,
              reservationExpiresAt: alignedExpiry,
            },
          });

          await tx.inventoryReservation.updateMany({
            where: { orderId: order.id, status: 'ACTIVE' },
            data: { expiresAt: alignedExpiry },
          });
        });

        return {
          status: 201,
          resourceId: order.id,
          body: {
            data: {
              orderId: order.id,
              sessionId: stripeSession.id,
              checkoutUrl: stripeSession.url,
              expiresAt: stripeSession.expiresAt.toISOString(),
            },
          },
        };
      },
    });
  }

  async ingestStripeWebhook({ rawBody, signatureHeader }) {
    const event = this.stripeClient.verifyWebhookEvent(rawBody, signatureHeader);
    const projection = this.stripeClient.projectWebhookEvent(event);

    const existing = await this.prisma.webhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (existing) {
      return { received: true, duplicate: true, eventId: existing.id };
    }

    // Validate orderId FK existence before storing optional orderId reference
    let linkedOrderId = null;
    if (projection.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: projection.orderId },
        select: { id: true },
      });
      if (order) linkedOrderId = order.id;
    }

    try {
      const created = await this.prisma.webhookEvent.create({
        data: {
          id: crypto.randomUUID(),
          stripeEventId: event.id,
          type: event.type,
          orderId: linkedOrderId,
          sessionId: projection.sessionId,
          payload: projection,
          status: SUPPORTED_WEBHOOK_TYPES.has(event.type) ? 'RECEIVED' : 'PROCESSED',
          processedAt: SUPPORTED_WEBHOOK_TYPES.has(event.type) ? null : new Date(),
        },
      });
      return { received: true, duplicate: false, eventId: created.id };
    } catch (err) {
      if (err.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Unable to persist webhook event.');
    }
  }

  async processWebhookEvent(webhookEventId) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const event = await tx.webhookEvent.findUnique({ where: { id: webhookEventId } });
      if (!event || event.status === 'PROCESSED' || event.status === 'REVIEW') {
        return { status: event?.status || 'NOT_FOUND' };
      }

      const payload = event.payload || {};
      const now = new Date();

      if (!SUPPORTED_WEBHOOK_TYPES.has(event.type)) {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: now },
        });
        return { status: 'PROCESSED' };
      }

      const orderId = event.orderId || payload.orderId;
      if (!orderId) {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'REVIEW', lastErrorCode: 'MISSING_ORDER_ID' },
        });
        return { status: 'REVIEW' };
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { reservations: true, items: true },
      });
      if (!order) {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'REVIEW', lastErrorCode: 'ORDER_NOT_FOUND' },
        });
        return { status: 'REVIEW' };
      }

      const isPaidEvent =
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded';
      const isFailureOrExpiryEvent =
        event.type === 'checkout.session.expired' ||
        event.type === 'checkout.session.async_payment_failed';

      if (isPaidEvent) {
        // Validate strict payment invariants
        const semanticValid =
          payload.livemode === false &&
          payload.mode === 'payment' &&
          payload.currency === 'usd' &&
          payload.paymentStatus === 'paid' &&
          payload.amountTotal === order.grandTotal &&
          (!order.stripeSessionId || order.stripeSessionId === payload.sessionId);

        if (!semanticValid) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'PAYMENT_REVIEW', version: order.version + 1 },
          });
          await tx.webhookEvent.update({
            where: { id: event.id },
            data: { status: 'REVIEW', lastErrorCode: 'SEMANTIC_MISMATCH' },
          });
          return { status: 'REVIEW' };
        }

        // Idempotent: already settled PAID or later fulfillment state
        if (order.status === 'PAID' || order.status === 'PROCESSING' || order.status === 'SHIPPED') {
          await tx.webhookEvent.update({
            where: { id: event.id },
            data: { status: 'PROCESSED', processedAt: now },
          });
          return { status: 'PROCESSED' };
        }

        // Contradictory late paid event after terminal release
        if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'PAYMENT_REVIEW', version: order.version + 1 },
          });
          await tx.webhookEvent.update({
            where: { id: event.id },
            data: { status: 'REVIEW', lastErrorCode: 'LATE_PAID_AFTER_RELEASE' },
          });
          return { status: 'REVIEW' };
        }

        // Consume ACTIVE reservations in deterministic product order
        const activeReservations = (order.reservations || [])
          .filter((r) => r.status === 'ACTIVE')
          .sort((a, b) => a.productId.localeCompare(b.productId));

        for (const resv of activeReservations) {
          await tx.inventoryReservation.update({
            where: { id: resv.id },
            data: { status: 'CONSUMED', resolvedAt: now },
          });
          const product = await tx.product.findUnique({ where: { id: resv.productId } });
          if (product) {
            await tx.product.update({
              where: { id: product.id },
              data: {
                stockOnHand: Math.max(0, product.stockOnHand - resv.quantity),
                stockReserved: Math.max(0, product.stockReserved - resv.quantity),
                version: product.version + 1,
              },
            });
          }
        }

        // Record Payment idempotently
        const existingPayment = await tx.payment.findUnique({ where: { orderId: order.id } });
        if (!existingPayment) {
          await tx.payment.create({
            data: {
              id: crypto.randomUUID(),
              orderId: order.id,
              stripeSessionId: payload.sessionId,
              stripePaymentIntentId: payload.paymentIntentId || null,
              amount: payload.amountTotal,
              currency: 'USD',
              status: 'SUCCEEDED',
              paidAt: now,
            },
          });
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            stripeSessionId: order.stripeSessionId || payload.sessionId,
            checkoutState: 'CLOSED',
            paidAt: now,
            version: order.version + 1,
          },
        });

        // Clear purchased cart lines ONLY if cart version still matches Order.cartVersion
        const cart = await tx.cart.findUnique({ where: { id: order.cartId } });
        if (cart && cart.version === order.cartVersion) {
          const purchasedProductIds = order.items.map((i) => i.productId);
          await tx.cartItem.deleteMany({
            where: {
              cartId: cart.id,
              productId: { in: purchasedProductIds },
            },
          });
          await tx.cart.update({
            where: { id: cart.id },
            data: { version: cart.version + 1 },
          });
        }

        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: now },
        });
        return { status: 'PROCESSED' };
      }

      if (isFailureOrExpiryEvent) {
        // Never regress PAID or later fulfillment states
        if (order.status === 'PENDING_PAYMENT') {
          await this.ordersService.releaseReservationsAndCancelOrder(tx, order.id, 'EXPIRED');
        }
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', processedAt: now },
        });
        return { status: 'PROCESSED' };
      }

      return { status: 'PROCESSED' };
    });
  }

  async settleOrderPaidFromStripeSession(orderId, remoteSession) {
    if (!remoteSession || remoteSession.payment_status !== 'paid') {
      return { settled: false };
    }
    return runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { reservations: true, items: true },
      });
      if (!order) return { settled: false };
      if (order.status === 'PAID' || order.status === 'PROCESSING' || order.status === 'SHIPPED') {
        return { settled: true, status: order.status };
      }
      if (order.status !== 'PENDING_PAYMENT') {
        return { settled: false, status: order.status };
      }

      const semanticValid =
        remoteSession.livemode === false &&
        remoteSession.mode === 'payment' &&
        remoteSession.currency === 'usd' &&
        remoteSession.payment_status === 'paid' &&
        remoteSession.amount_total === order.grandTotal &&
        (!order.stripeSessionId || order.stripeSessionId === remoteSession.id);

      if (!semanticValid) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAYMENT_REVIEW', version: order.version + 1 },
        });
        return { settled: false, status: 'PAYMENT_REVIEW' };
      }

      const now = new Date();
      const activeReservations = (order.reservations || [])
        .filter((r) => r.status === 'ACTIVE')
        .sort((a, b) => a.productId.localeCompare(b.productId));

      for (const resv of activeReservations) {
        await tx.inventoryReservation.update({
          where: { id: resv.id },
          data: { status: 'CONSUMED', resolvedAt: now },
        });
        const product = await tx.product.findUnique({ where: { id: resv.productId } });
        if (product) {
          await tx.product.update({
            where: { id: product.id },
            data: {
              stockOnHand: Math.max(0, product.stockOnHand - resv.quantity),
              stockReserved: Math.max(0, product.stockReserved - resv.quantity),
              version: product.version + 1,
            },
          });
        }
      }

      const existingPayment = await tx.payment.findUnique({ where: { orderId: order.id } });
      if (!existingPayment) {
        const paymentIntentId =
          typeof remoteSession.payment_intent === 'string'
            ? remoteSession.payment_intent
            : remoteSession.payment_intent?.id || null;
        await tx.payment.create({
          data: {
            id: crypto.randomUUID(),
            orderId: order.id,
            stripeSessionId: remoteSession.id,
            stripePaymentIntentId: paymentIntentId,
            amount: remoteSession.amount_total,
            currency: 'USD',
            status: 'SUCCEEDED',
            paidAt: now,
          },
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          stripeSessionId: order.stripeSessionId || remoteSession.id,
          checkoutState: 'CLOSED',
          paidAt: now,
          version: order.version + 1,
        },
      });

      const cart = await tx.cart.findUnique({ where: { id: order.cartId } });
      if (cart && cart.version === order.cartVersion) {
        const purchasedProductIds = order.items.map((i) => i.productId);
        await tx.cartItem.deleteMany({
          where: {
            cartId: cart.id,
            productId: { in: purchasedProductIds },
          },
        });
        await tx.cart.update({
          where: { id: cart.id },
          data: { version: cart.version + 1 },
        });
      }

      return { settled: true, status: 'PAID' };
    });
  }

  async reconcilePendingWork() {
    const now = new Date();

    // 1. Process received webhook events
    const pendingEvents = await this.prisma.webhookEvent.findMany({
      where: {
        status: 'RECEIVED',
        nextAttemptAt: { lte: now },
      },
      orderBy: { receivedAt: 'asc' },
      take: 25,
    });

    for (const evt of pendingEvents) {
      await this.processWebhookEvent(evt.id).catch(() => {});
    }

    // 2. Release expired unstarted orders (no Stripe session ever started)
    const expiredUnstartedOrders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        checkoutState: 'NOT_STARTED',
        stripeSessionId: null,
        reservationExpiresAt: { lte: now },
      },
      take: 25,
    });

    for (const order of expiredUnstartedOrders) {
      await runSerializableTransaction(this.prisma, async (tx) => {
        await this.ordersService.releaseReservationsAndCancelOrder(tx, order.id, 'EXPIRED');
      }).catch(() => {});
    }

    // 3. Reconcile PENDING_PAYMENT orders that have a Stripe Checkout session
    //    - If paid on Stripe (even if webhook was missed), settle to PAID automatically
    //    - If expired or cancelled-intent unpaid, expire on Stripe and release stock
    const pendingStripeOrders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        stripeSessionId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: 25,
    });

    for (const order of pendingStripeOrders) {
      try {
        const remote = await this.stripeClient.retrieveCheckoutSession(order.stripeSessionId);
        if (remote.payment_status === 'paid') {
          await this.settleOrderPaidFromStripeSession(order.id, remote);
          continue;
        }
        const isExpired = new Date(order.reservationExpiresAt) <= now || remote.status === 'expired';
        if (isExpired || order.cancellationRequestedAt) {
          if (remote.status === 'open') {
            await this.stripeClient.expireCheckoutSession(order.stripeSessionId);
          }
          const targetStatus = order.cancellationRequestedAt ? 'CANCELLED' : 'EXPIRED';
          await runSerializableTransaction(this.prisma, async (tx) => {
            await this.ordersService.releaseReservationsAndCancelOrder(tx, order.id, targetStatus);
          });
        }
      } catch (_) {
        // Provider unreachable: keep reservation safely until next tick
      }
    }
  }
}

module.exports = { PaymentsService };
