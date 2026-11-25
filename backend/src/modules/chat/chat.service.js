const { AppError } = require('../../config/errors');
const {
  NO_EVIDENCE_ANSWER,
  redactSensitiveInput,
  containsSensitiveLeak,
} = require('../../integrations/llm/llm.client');

const MAX_IN_FLIGHT_PER_IP = 2;
const MAX_IN_FLIGHT_GLOBAL = 10;

function noEvidenceResponse() {
  return {
    answer: NO_EVIDENCE_ANSWER,
    citations: [],
    escalated: true,
  };
}

class ChatService {
  constructor({ knowledgeRepository, llmClient, productsRepository = null }) {
    this.knowledgeRepository = knowledgeRepository;
    this.llmClient = llmClient;
    this.productsRepository = productsRepository;
    this.inFlightGlobal = 0;
    this.inFlightByIp = new Map();
  }

  acquireInFlight(ipKey) {
    const currentIp = this.inFlightByIp.get(ipKey) || 0;
    if (currentIp >= MAX_IN_FLIGHT_PER_IP || this.inFlightGlobal >= MAX_IN_FLIGHT_GLOBAL) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many concurrent support requests. Please retry shortly.',
        [],
        { 'Retry-After': '1' }
      );
    }
    this.inFlightGlobal += 1;
    this.inFlightByIp.set(ipKey, currentIp + 1);
  }

  releaseInFlight(ipKey) {
    this.inFlightGlobal = Math.max(0, this.inFlightGlobal - 1);
    const currentIp = (this.inFlightByIp.get(ipKey) || 1) - 1;
    if (currentIp <= 0) this.inFlightByIp.delete(ipKey);
    else this.inFlightByIp.set(ipKey, currentIp);
  }

  async answerMessage({ message, ipKey }) {
    this.acquireInFlight(ipKey);
    try {
      const { redacted } = redactSensitiveInput(message);
      const meaningfulText = redacted.replace(/\[REDACTED_[A-Z]+\]/g, '').trim();
      if (meaningfulText.length < 2) {
        return noEvidenceResponse();
      }

      // Retrieve ONLY approved chunks (all DRAFT docs in docs/ai-knowledge/ are excluded)
      const chunks = await this.knowledgeRepository.searchApprovedChunks(redacted, 5);
      if (chunks.length === 0 || !this.llmClient.isConfigured()) {
        return noEvidenceResponse();
      }

      // If the retrieved approved chunks include the store's product-catalog doc, attach live public catalog items
      let catalogContext = null;
      const hasCatalogChunk = chunks.some((c) => c.documentId === 'product-catalog');
      if (hasCatalogChunk && this.productsRepository) {
        try {
          const catalog = await this.productsRepository.listProducts({
            active: true,
            sort: 'newest',
            page: 1,
            pageSize: 20,
          });
          if (catalog?.data?.length > 0) {
            catalogContext = catalog.data
              .map(
                (p) =>
                  `- ${p.name} (${p.category.name}) — $${(p.price / 100).toFixed(2)} USD, ${p.availableQuantity} in stock: ${p.description}`
              )
              .join('\n');
          }
        } catch (_) {
          // Graceful fallback if catalog read fails
        }
      }

      const llmOutput = await this.llmClient.generateGroundedAnswer({
        redactedQuestion: redacted,
        chunks,
        catalogContext,
      });

      if (!llmOutput || !llmOutput.answer || llmOutput.answer.length > 4000) {
        return noEvidenceResponse();
      }

      if (llmOutput.answer === NO_EVIDENCE_ANSWER || llmOutput.citationIds.length === 0) {
        return noEvidenceResponse();
      }

      if (containsSensitiveLeak(llmOutput.answer)) {
        return noEvidenceResponse();
      }

      // Verify every cited chunk ID belongs to the retrieved approved set
      const chunkMap = new Map(chunks.map((c) => [c.id, c]));
      const verifiedChunks = [];
      const seenCitationKeys = new Set();

      for (const cid of llmOutput.citationIds) {
        const chunk = chunkMap.get(cid);
        if (!chunk) {
          return noEvidenceResponse();
        }
        const dedupeKey = `${chunk.documentId}|${chunk.version}|${chunk.section}`;
        if (!seenCitationKeys.has(dedupeKey)) {
          seenCitationKeys.add(dedupeKey);
          verifiedChunks.push(chunk);
        }
      }

      if (verifiedChunks.length === 0 || verifiedChunks.length > 5) {
        return noEvidenceResponse();
      }

      // Re-verify approval status right before publishing (revocation guard)
      const stillApproved = await this.knowledgeRepository.areDocumentVersionsStillApproved(
        verifiedChunks.map((c) => c.documentVersionId)
      );
      if (!stillApproved) {
        return noEvidenceResponse();
      }

      return {
        answer: llmOutput.answer,
        citations: verifiedChunks.map((c) => ({
          documentId: c.documentId,
          title: c.title,
          version: c.version,
          section: c.section,
        })),
        escalated: false,
      };
    } finally {
      this.releaseInFlight(ipKey);
    }
  }
}

module.exports = {
  ChatService,
  noEvidenceResponse,
};
