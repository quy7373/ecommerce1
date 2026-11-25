const INTENT_RULES = [
  {
    docId: 'product-catalog',
    keywords: [
      'product', 'products', 'catalog', 'item', 'items', 'price', 'prices', 'cost',
      'expensive', 'cheapest', 'cheap', 'budget', 'recommend', 'recommendation',
      'best', 'popular', 'featured', 'stock', 'available', 'category', 'categories',
      'sell', 'selling', 'buy', 'shop', 'store', 'laptop', 'phone', 'smartphone',
      'tablet', 'watch', 'shoe', 'shoes', 'furniture', 'electronics', 'accessory',
      'accessories', 'apparel', 'grocery', 'groceries', 'beauty', 'sport', 'sports',
      'sản phẩm', 'san pham', 'đắt', 'dat', 'rẻ', 're', 'giá', 'gia', 'mua', 'bán',
      'ban', 'danh mục', 'danh muc', 'mặt hàng', 'mat hang', 'tồn kho', 'còn hàng',
      'hết hàng', 'tư vấn', 'tu van', 'gợi ý', 'goi y', 'nổi bật', 'noi bat',
      'điện thoại', 'dien thoai', 'máy tính', 'giày', 'giay', 'đồng hồ', 'dong ho',
      'nội thất', 'thời trang', 'phụ kiện', 'đồ', 'hàng',
    ],
  },
  {
    docId: 'ordering-guide',
    sectionHint: 'welcome',
    keywords: [
      'hi', 'hello', 'hey', 'greetings', 'help', 'support', 'who are you',
      'what can you do', 'about', 'chào', 'chao', 'xin chào', 'xin chao',
      'alo', 'giúp', 'giup', 'hỗ trợ', 'ho tro', 'bạn là ai', 'web này', 'trang web',
    ],
  },
  {
    docId: 'ordering-guide',
    keywords: [
      'order', 'ordering', 'cart', 'checkout', 'account', 'login', 'sign in',
      'register', 'password', 'google', 'đặt hàng', 'dat hang', 'giỏ hàng',
      'gio hang', 'tài khoản', 'tai khoan', 'đăng nhập', 'dang nhap', 'đăng ký',
      'dang ky', 'mật khẩu',
    ],
  },
  {
    docId: 'shipping-policy',
    keywords: [
      'ship', 'shipping', 'delivery', 'deliver', 'address', 'fulfillment',
      'tracking', 'track', 'rate', 'rates', 'giao hàng', 'giao hang', 'vận chuyển',
      'van chuyen', 'phí ship', 'phi ship', 'địa chỉ', 'dia chi', 'bao lâu',
    ],
  },
  {
    docId: 'return-policy',
    keywords: [
      'return', 'returns', 'refund', 'refunds', 'cancel', 'cancellation',
      'exchange', 'đổi trả', 'doi tra', 'hoàn tiền', 'hoan tien', 'hủy đơn',
      'huy don', 'hủy', 'trả hàng',
    ],
  },
  {
    docId: 'payment-policy',
    keywords: [
      'pay', 'payment', 'payments', 'stripe', 'card', 'credit', 'debit',
      'currency', 'usd', 'invoice', 'thanh toán', 'thanh toan', 'thẻ', 'chuyển khoản',
    ],
  },
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesKeyword(normalizedQuery, keyword) {
  if (keyword.length <= 3) {
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(keyword)}($|[^\\p{L}\\p{N}])`, 'u').test(
      normalizedQuery
    );
  }
  return normalizedQuery.includes(keyword);
}

class KnowledgeRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Retrieves ONLY APPROVED documents (never DRAFT or RETIRED) with identified owner
   * and non-null approvedAt. Limits to max 5 relevant chunks of <= 4000 characters.
   */
  async searchApprovedChunks(redactedQuery, maxChunks = 5) {
    const normalizedQuery = String(redactedQuery || '')
      .toLowerCase()
      .normalize('NFC')
      .trim();

    const terms = normalizedQuery
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2)
      .slice(0, 12);

    if (terms.length === 0) return [];

    const approvedDocs = await this.prisma.knowledgeDocument.findMany({
      where: {
        status: 'APPROVED',
        approvedAt: { not: null },
      },
      include: {
        chunks: {
          orderBy: { ordinal: 'asc' },
        },
      },
    });

    const validDocs = approvedDocs.filter(
      (doc) => doc.owner && doc.approvedAt && doc.status === 'APPROVED'
    );
    if (validDocs.length === 0) return [];

    const intentBoostByDoc = new Map();
    const intentBoostBySection = new Map();
    for (const rule of INTENT_RULES) {
      let hits = 0;
      for (const kw of rule.keywords) {
        if (matchesKeyword(normalizedQuery, kw)) hits += 1;
      }
      if (hits > 0) {
        if (rule.sectionHint) {
          const key = `${rule.docId}|${rule.sectionHint}`;
          intentBoostBySection.set(key, (intentBoostBySection.get(key) || 0) + hits * 4);
        } else {
          intentBoostByDoc.set(rule.docId, (intentBoostByDoc.get(rule.docId) || 0) + hits * 3);
        }
      }
    }

    const allChunks = [];
    const scored = [];
    for (const doc of validDocs) {
      for (const chunk of doc.chunks || []) {
        const entry = {
          id: chunk.id,
          documentVersionId: doc.id,
          documentId: doc.documentId,
          title: doc.title,
          version: doc.version,
          section: chunk.section,
          content: chunk.content.slice(0, 4000),
          score: 0,
        };
        allChunks.push(entry);

        const haystack = `${doc.title} ${chunk.section} ${chunk.content}`.toLowerCase();
        const sectionLower = String(chunk.section || '').toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (matchesKeyword(haystack, term)) score += 1;
        }
        score += intentBoostByDoc.get(doc.documentId) || 0;
        for (const [secKey, boost] of intentBoostBySection.entries()) {
          const [targetDocId, hint] = secKey.split('|');
          if (doc.documentId === targetDocId && sectionLower.includes(hint)) {
            score += boost;
          }
        }

        if (score > 0) {
          entry.score = score;
          scored.push(entry);
        }
      }
    }

    const limit = Math.min(maxChunks, 5);
    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      return scored.slice(0, limit);
    }

    // Multilingual fallback when approved docs exist but query terms don't literally match English text
    const fallbackPriority = ['product-catalog', 'ordering-guide', 'shipping-policy', 'return-policy', 'payment-policy'];
    allChunks.sort((a, b) => {
      const pa = fallbackPriority.indexOf(a.documentId);
      const pb = fallbackPriority.indexOf(b.documentId);
      const ra = pa === -1 ? 99 : pa;
      const rb = pb === -1 ? 99 : pb;
      return ra - rb || a.id.localeCompare(b.id);
    });
    return allChunks.slice(0, limit);
  }

  async areDocumentVersionsStillApproved(documentVersionIds) {
    if (!documentVersionIds || documentVersionIds.length === 0) return false;
    const uniqueIds = Array.from(new Set(documentVersionIds));
    const count = await this.prisma.knowledgeDocument.count({
      where: {
        id: { in: uniqueIds },
        status: 'APPROVED',
        approvedAt: { not: null },
      },
    });
    return count === uniqueIds.length;
  }
}

module.exports = { KnowledgeRepository };
