class CategoriesRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async listAll() {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
    }));
  }

  async findById(id) {
    return this.prisma.category.findUnique({ where: { id } });
  }
}

module.exports = { CategoriesRepository };
