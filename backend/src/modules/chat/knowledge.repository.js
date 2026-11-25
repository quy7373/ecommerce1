class KnowledgeRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Retrieves ONLY APPROVED documents (never DRAFT or RETIRED) with identified owner
   * and non-null approvedAt. Limits to max 5 relevant chunks of <= 4000 characters.
   */
  async searchApprovedChunks(redactedQuery, maxChunks = 5) {
    const terms = String(redactedQuery || '')
      .toLowerCase()
      .normalize('NFC')
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

    const scored = [];
    for (const doc of approvedDocs) {
      if (!doc.owner || !doc.approvedAt || doc.status !== 'APPROVED') continue;
      for (const chunk of doc.chunks || []) {
        const haystack = `${doc.title} ${chunk.section} ${chunk.content}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (haystack.includes(term)) score += 1;
        }
        if (score > 0) {
          scored.push({
            id: chunk.id,
            documentVersionId: doc.id,
            documentId: doc.documentId,
            title: doc.title,
            version: doc.version,
            section: chunk.section,
            content: chunk.content.slice(0, 4000),
            score,
          });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return scored.slice(0, Math.min(maxChunks, 5));
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
