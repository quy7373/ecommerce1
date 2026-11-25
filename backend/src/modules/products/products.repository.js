function toProductDto(product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: {
      id: product.category.id,
      name: product.category.name,
      slug: product.category.slug,
    },
    price: product.price,
    currency: 'USD',
    imageUrl: product.imageUrl ?? null,
    availableQuantity: Math.max(0, product.stockOnHand - product.stockReserved),
    active: product.active,
    version: product.version,
  };
}

function buildOrderBy(sort) {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ price: 'desc' }, { id: 'asc' }];
    case 'name_asc':
      return [{ name: 'asc' }, { id: 'asc' }];
    case 'newest':
    default:
      return [{ createdAt: 'desc' }, { id: 'asc' }];
  }
}

class ProductsRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async listProducts({ q, categoryId, minPrice, maxPrice, inStock, active, sort, page, pageSize }) {
    const where = {};
    if (active !== undefined) {
      where.active = active;
    }
    if (categoryId) {
      where.categoryId = categoryId;
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Note: inStock compares stockOnHand > stockReserved. Fetch & filter when inStock===true
    // to stay strictly parameterized without raw SQL identifier assumptions.
    const orderBy = buildOrderBy(sort);

    if (inStock === true) {
      const allMatching = await this.prisma.product.findMany({
        where,
        include: { category: true },
        orderBy,
      });
      const available = allMatching.filter((p) => p.stockOnHand - p.stockReserved > 0);
      const totalItems = available.length;
      const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
      const slice = available.slice((page - 1) * pageSize, page * pageSize);
      return {
        data: slice.map(toProductDto),
        pagination: { page, pageSize, totalItems, totalPages },
      };
    }

    const [totalItems, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: { category: true },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
    return {
      data: rows.map(toProductDto),
      pagination: { page, pageSize, totalItems, totalPages },
    };
  }

  async findById(productId, { activeOnly = true } = {}) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (!product) return null;
    if (activeOnly && !product.active) return null;
    return toProductDto(product);
  }
}

module.exports = {
  ProductsRepository,
  toProductDto,
};
