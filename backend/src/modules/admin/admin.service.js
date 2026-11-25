const crypto = require('crypto');
const { config } = require('../../config/env');
const { encryptEnvelope } = require('../../config/crypto');
const { AppError, validationError } = require('../../config/errors');
const { runSerializableTransaction } = require('../../config/prisma');
const { validateImageUrl } = require('../../middleware/validate');
const { toProductDto } = require('../products/products.repository');
const { toOrderDto } = require('../orders/orders.service');

const MAX_ORDER_MONEY = 100_000_000;
const RESERVATION_TTL_MS = 30 * 60 * 1000;

const ALLOWED_ADMIN_TRANSITIONS = {
  PAID: 'PROCESSING',
  PROCESSING: 'SHIPPED',
};

class AdminService {
  constructor(prisma, { productsRepository, ordersService }) {
    this.prisma = prisma;
    this.productsRepository = productsRepository;
    this.ordersService = ordersService;
  }

  async listOrders(filters) {
    return this.ordersService.listOrders({ ...filters, userId: undefined });
  }

  async getOrder(orderId) {
    return this.ordersService.getOrder({ orderId, userId: undefined });
  }

  async updateOrderStatus({ orderId, status, version, actorId, requestId }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      }
      if (order.version !== version) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Order version mismatch. Please refresh.');
      }
      if (ALLOWED_ADMIN_TRANSITIONS[order.status] !== status) {
        throw new AppError(
          409,
          'INVALID_ORDER_TRANSITION',
          `Cannot transition order from ${order.status} to ${status}.`
        );
      }

      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status,
          version: order.version + 1,
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          actorId,
          resourceType: 'ORDER',
          resourceId: order.id,
          action: 'UPDATE_ORDER_STATUS',
          changes: { previousStatus: order.status, newStatus: status },
          requestId,
        },
      });

      return toOrderDto(updated);
    });
  }

  async createOrder({ data, actorId, requestId }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      let targetUserId = actorId;
      if (data.customerEmail) {
        const normalizedEmail = data.customerEmail.trim().toLowerCase();
        const customer = await tx.user.findUnique({ where: { email: normalizedEmail } });
        if (!customer) {
          throw validationError([
            {
              field: 'customerEmail',
              code: 'NOT_FOUND',
              message: 'No registered user found with this email address.',
            },
          ]);
        }
        targetUserId = customer.id;
      }

      let cart = await tx.cart.findUnique({ where: { userId: targetUserId } });
      if (!cart) {
        cart = await tx.cart.create({
          data: { id: crypto.randomUUID(), userId: targetUserId, version: 1 },
        });
      }

      // Merge duplicate productIds cleanly
      const qtyByProduct = new Map();
      for (const item of data.items) {
        qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) || 0) + item.quantity);
      }
      const sortedProductIds = Array.from(qtyByProduct.keys()).sort();
      const products = await tx.product.findMany({
        where: { id: { in: sortedProductIds } },
      });
      const productById = new Map(products.map((p) => [p.id, p]));

      const orderItemsData = [];
      let subtotal = 0;

      for (const productId of sortedProductIds) {
        const quantity = qtyByProduct.get(productId);
        if (quantity > 99) {
          throw new AppError(409, 'CART_LIMIT_EXCEEDED', 'Item quantity cannot exceed 99.');
        }
        const product = productById.get(productId);
        if (!product || !product.active) {
          throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'One or more selected products are unavailable.');
        }
        const available = product.stockOnHand - product.stockReserved;
        if (quantity > available) {
          throw new AppError(
            409,
            'OUT_OF_STOCK',
            `Insufficient stock for "${product.name}" (available: ${available}).`
          );
        }
        const lineTotal = product.price * quantity;
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
          quantity,
          lineTotal,
          currentStockReserved: product.stockReserved,
          currentVersion: product.version,
        });
      }

      const orderId = crypto.randomUUID();
      const now = new Date();
      const reservationExpiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
      const encryptedAddress = encryptEnvelope(data.shippingAddress, {
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
          userId: targetUserId,
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

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          actorId,
          resourceType: 'ORDER',
          resourceId: createdOrder.id,
          action: 'UPDATE_ORDER_STATUS',
          changes: {
            operation: 'ADMIN_CREATE_ORDER',
            status: 'PENDING_PAYMENT',
            grandTotal: subtotal,
          },
          requestId,
        },
      });

      return toOrderDto(createdOrder);
    });
  }

  async updateOrder({ orderId, data, actorId, requestId }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true, reservations: true },
      });
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      }
      if (order.version !== data.version) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Order version mismatch. Please refresh.');
      }

      const now = new Date();
      const updateData = { version: order.version + 1 };
      const auditChanges = {};

      if (data.shippingAddress !== undefined) {
        updateData.shippingAddress = encryptEnvelope(data.shippingAddress, {
          entity: 'Order',
          rowId: order.id,
          field: 'shippingAddress',
        });
        auditChanges.shippingAddressUpdated = true;
      }

      if (data.status !== undefined && data.status !== order.status) {
        // Release active reservations if moving out of PENDING_PAYMENT to CANCELLED / EXPIRED
        if (
          order.status === 'PENDING_PAYMENT' &&
          (data.status === 'CANCELLED' || data.status === 'EXPIRED')
        ) {
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
          updateData.checkoutState = 'CLOSED';
        }

        // Consume active reservations if manually marked PAID
        if (order.status === 'PENDING_PAYMENT' && data.status === 'PAID') {
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
          updateData.paidAt = order.paidAt || now;
          updateData.checkoutState = 'CLOSED';
        }

        updateData.status = data.status;
        auditChanges.previousStatus = order.status;
        auditChanges.newStatus = data.status;
      }

      const updated = await tx.order.update({
        where: { id: order.id },
        data: updateData,
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          actorId,
          resourceType: 'ORDER',
          resourceId: order.id,
          action: 'UPDATE_ORDER_STATUS',
          changes: { operation: 'ADMIN_UPDATE_ORDER', ...auditChanges },
          requestId,
        },
      });

      return toOrderDto(updated);
    });
  }

  async deleteOrder({ orderId, version, actorId, requestId }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { reservations: true },
      });
      if (!order) {
        throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      }
      if (order.version !== version) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Order version mismatch. Please refresh.');
      }

      // Release any active stock reservations before deleting order
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

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          actorId,
          resourceType: 'ORDER',
          resourceId: order.id,
          action: 'UPDATE_ORDER_STATUS',
          changes: {
            operation: 'ADMIN_DELETE_ORDER',
            deletedStatus: order.status,
            grandTotal: order.grandTotal,
          },
          requestId,
        },
      });
    });
  }

  async listProducts(filters) {
    return this.productsRepository.listProducts(filters);
  }

  async getProduct(productId) {
    const product = await this.productsRepository.findById(productId, { activeOnly: false });
    if (!product) {
      throw new AppError(404, 'NOT_FOUND', 'Product not found.');
    }
    return product;
  }

  async createProduct({ data, actorId, requestId }) {
    const imgCheck = validateImageUrl(data.imageUrl, {
      isProduction: config.isProduction,
      approvedOrigins: config.approvedImageCdnOrigins,
    });
    if (!imgCheck.valid) {
      throw validationError([{ field: 'imageUrl', code: 'FORMAT', message: imgCheck.message }]);
    }

    return runSerializableTransaction(this.prisma, async (tx) => {
      const category = await tx.category.findUnique({ where: { id: data.categoryId } });
      if (!category) {
        throw validationError([
          { field: 'categoryId', code: 'FORMAT', message: 'Referenced category does not exist.' },
        ]);
      }

      const existingSku = await tx.product.findUnique({ where: { sku: data.sku } });
      if (existingSku) {
        throw new AppError(409, 'SKU_CONFLICT', 'A product with this SKU already exists.');
      }

      const productId = crypto.randomUUID();
      const created = await tx.product.create({
        data: {
          id: productId,
          sku: data.sku,
          name: data.name,
          description: data.description,
          categoryId: data.categoryId,
          price: data.price,
          currency: 'USD',
          imageUrl: data.imageUrl,
          stockOnHand: data.stockOnHand,
          stockReserved: 0,
          active: data.active,
          version: 1,
        },
        include: { category: true },
      });

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          actorId,
          resourceType: 'PRODUCT',
          resourceId: created.id,
          action: 'CREATE_PRODUCT',
          changes: { sku: created.sku, price: created.price, stockOnHand: created.stockOnHand, active: created.active },
          requestId,
        },
      });

      return toProductDto(created);
    });
  }

  async updateProduct({ productId, data, actorId, requestId }) {
    if (data.imageUrl !== undefined) {
      const imgCheck = validateImageUrl(data.imageUrl, {
        isProduction: config.isProduction,
        approvedOrigins: config.approvedImageCdnOrigins,
      });
      if (!imgCheck.valid) {
        throw validationError([{ field: 'imageUrl', code: 'FORMAT', message: imgCheck.message }]);
      }
    }

    return runSerializableTransaction(this.prisma, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new AppError(404, 'NOT_FOUND', 'Product not found.');
      }
      if (product.version !== data.version) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Product version mismatch. Please refresh.');
      }
      if (data.stockOnHand !== undefined && data.stockOnHand < product.stockReserved) {
        throw new AppError(
          409,
          'STOCK_RESERVED',
          'stockOnHand cannot be reduced below currently reserved inventory.'
        );
      }
      if (data.categoryId !== undefined && data.categoryId !== product.categoryId) {
        const category = await tx.category.findUnique({ where: { id: data.categoryId } });
        if (!category) {
          throw validationError([
            { field: 'categoryId', code: 'FORMAT', message: 'Referenced category does not exist.' },
          ]);
        }
      }
      if (data.sku !== undefined && data.sku !== product.sku) {
        const existingSku = await tx.product.findUnique({ where: { sku: data.sku } });
        if (existingSku) {
          throw new AppError(409, 'SKU_CONFLICT', 'A product with this SKU already exists.');
        }
      }

      const updateFields = {};
      const allowedFields = [
        'sku',
        'name',
        'description',
        'categoryId',
        'price',
        'imageUrl',
        'stockOnHand',
        'active',
      ];
      for (const f of allowedFields) {
        if (data[f] !== undefined) updateFields[f] = data[f];
      }

      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          ...updateFields,
          version: product.version + 1,
        },
        include: { category: true },
      });

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          actorId,
          resourceType: 'PRODUCT',
          resourceId: product.id,
          action: 'UPDATE_PRODUCT',
          changes: updateFields,
          requestId,
        },
      });

      return toProductDto(updated);
    });
  }

  async archiveProduct({ productId, version, actorId, requestId }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new AppError(404, 'NOT_FOUND', 'Product not found.');
      }
      if (product.version !== version) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Product version mismatch. Please refresh.');
      }
      if (!product.active) {
        return;
      }

      await tx.product.update({
        where: { id: product.id },
        data: {
          active: false,
          version: product.version + 1,
        },
      });

      await tx.auditLog.create({
        data: {
          id: crypto.randomUUID(),
          actorId,
          resourceType: 'PRODUCT',
          resourceId: product.id,
          action: 'ARCHIVE_PRODUCT',
          changes: { active: false },
          requestId,
        },
      });
    });
  }
}

module.exports = { AdminService };
