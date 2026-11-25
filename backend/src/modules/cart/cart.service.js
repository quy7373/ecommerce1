const crypto = require('crypto');
const { AppError } = require('../../config/errors');
const { runSerializableTransaction } = require('../../config/prisma');
const { toProductDto } = require('../products/products.repository');

const MAX_CART_LINES = 50;
const MAX_LINE_QTY = 99;
const MAX_CART_MONEY = 495_000_000_000;

function formatCartDto(cart) {
  const items = (cart.items || [])
    .slice()
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((item) => {
      const productDto = toProductDto(item.product);
      const lineTotal = item.product.price * item.quantity;
      return {
        product: productDto,
        quantity: item.quantity,
        lineTotal,
      };
    });

  const subtotal = items.reduce((acc, item) => acc + item.lineTotal, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal > MAX_CART_MONEY) {
    throw new AppError(409, 'TOTAL_LIMIT_EXCEEDED', 'Cart subtotal exceeds maximum supported bound.');
  }

  return {
    id: cart.id,
    version: cart.version,
    items,
    subtotal,
    shippingTotal: 0,
    taxTotal: 0,
    grandTotal: subtotal,
    currency: 'USD',
  };
}

class CartService {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async ensureCart(tx, userId) {
    let cart = await tx.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: { include: { category: true } },
          },
        },
      },
    });
    if (!cart) {
      try {
        cart = await tx.cart.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            version: 1,
          },
          include: {
            items: {
              include: {
                product: { include: { category: true } },
              },
            },
          },
        });
      } catch (err) {
        if (err && err.code === 'P2002') {
          cart = await tx.cart.findUnique({
            where: { userId },
            include: {
              items: {
                include: {
                  product: { include: { category: true } },
                },
              },
            },
          });
        } else {
          throw err;
        }
      }
    }
    return cart;
  }

  async getCart(userId) {
    const cart = await this.ensureCart(this.prisma, userId);
    return formatCartDto(cart);
  }

  async addItem(userId, { productId, quantity, cartVersion }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const cart = await this.ensureCart(tx, userId);
      if (cart.version !== cartVersion) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Cart was modified by another request. Please refresh.');
      }

      const product = await tx.product.findUnique({
        where: { id: productId },
        include: { category: true },
      });
      if (!product || !product.active) {
        throw new AppError(404, 'NOT_FOUND', 'Product not found or inactive.');
      }

      const existingItem = cart.items.find((i) => i.productId === productId);
      if (!existingItem && cart.items.length >= MAX_CART_LINES) {
        throw new AppError(409, 'CART_LIMIT_EXCEEDED', 'Cart cannot contain more than 50 distinct items.');
      }

      const nextQty = (existingItem ? existingItem.quantity : 0) + quantity;
      if (nextQty > MAX_LINE_QTY) {
        throw new AppError(409, 'CART_LIMIT_EXCEEDED', 'Item quantity cannot exceed 99.');
      }

      const available = product.stockOnHand - product.stockReserved;
      if (nextQty > available) {
        throw new AppError(409, 'OUT_OF_STOCK', 'Requested quantity exceeds available stock.');
      }

      if (existingItem) {
        await tx.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: nextQty },
        });
      } else {
        await tx.cartItem.create({
          data: {
            id: crypto.randomUUID(),
            cartId: cart.id,
            productId,
            quantity: nextQty,
          },
        });
      }

      const updatedCart = await tx.cart.update({
        where: { id: cart.id },
        data: { version: cart.version + 1 },
        include: {
          items: {
            include: {
              product: { include: { category: true } },
            },
          },
        },
      });

      return formatCartDto(updatedCart);
    });
  }

  async updateItem(userId, productId, { quantity, cartVersion }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const cart = await this.ensureCart(tx, userId);
      if (cart.version !== cartVersion) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Cart was modified by another request. Please refresh.');
      }

      const existingItem = cart.items.find((i) => i.productId === productId);
      if (!existingItem) {
        throw new AppError(404, 'NOT_FOUND', 'Cart item not found.');
      }

      const product = existingItem.product;
      if (!product.active) {
        throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'Product is no longer active.');
      }

      const available = product.stockOnHand - product.stockReserved;
      if (quantity > available) {
        throw new AppError(409, 'OUT_OF_STOCK', 'Requested quantity exceeds available stock.');
      }

      await tx.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity },
      });

      const updatedCart = await tx.cart.update({
        where: { id: cart.id },
        data: { version: cart.version + 1 },
        include: {
          items: {
            include: {
              product: { include: { category: true } },
            },
          },
        },
      });

      return formatCartDto(updatedCart);
    });
  }

  async removeItem(userId, productId, { cartVersion }) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const cart = await this.ensureCart(tx, userId);
      if (cart.version !== cartVersion) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Cart was modified by another request. Please refresh.');
      }

      const existingItem = cart.items.find((i) => i.productId === productId);
      if (!existingItem) {
        throw new AppError(404, 'NOT_FOUND', 'Cart item not found.');
      }

      await tx.cartItem.delete({ where: { id: existingItem.id } });

      const updatedCart = await tx.cart.update({
        where: { id: cart.id },
        data: { version: cart.version + 1 },
        include: {
          items: {
            include: {
              product: { include: { category: true } },
            },
          },
        },
      });

      return formatCartDto(updatedCart);
    });
  }
}

module.exports = {
  CartService,
  formatCartDto,
};
