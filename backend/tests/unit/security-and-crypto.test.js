process.env.NODE_ENV = 'test';

const Stripe = require('stripe');
const {
  encryptEnvelope,
  decryptEnvelope,
  signSessionJwt,
  verifySessionJwt,
} = require('../../src/config/crypto');
const { inspectRawJsonForDuplicatesAndProto } = require('../../src/middleware/jsonParser');
const { StripeClient, validateStripeCheckoutUrl } = require('../../src/integrations/stripe/stripe.client');
const { LlmClient, redactSensitiveInput, passesLuhn } = require('../../src/integrations/llm/llm.client');

describe('Unit: Crypto, JSON Parser, Stripe & LLM Redaction', () => {
  describe('AES-256-GCM envelope encryption with AAD', () => {
    it('encrypts and decrypts with matching AAD context', () => {
      const address = {
        fullName: 'Jane Doe',
        line1: '123 Main St',
        city: 'Austin',
        region: 'TX',
        postalCode: '78701',
        country: 'US',
      };
      const aad = { entity: 'Order', rowId: '11111111-1111-4111-8111-111111111111', field: 'shippingAddress' };
      const envelope = encryptEnvelope(address, aad);

      expect(envelope.encVersion).toBe(1);
      expect(typeof envelope.keyId).toBe('string');
      expect(typeof envelope.wrappedKey).toBe('string');
      expect(typeof envelope.iv).toBe('string');
      expect(typeof envelope.ciphertext).toBe('string');
      expect(typeof envelope.tag).toBe('string');

      const decrypted = JSON.parse(decryptEnvelope(envelope, aad));
      expect(decrypted).toEqual(address);
    });

    it('fails decryption when AAD rowId does not match', () => {
      const envelope = encryptEnvelope('secret-verifier', {
        entity: 'OAuthAttempt',
        rowId: 'row-a',
        field: 'encryptedCodeVerifier',
      });

      expect(() =>
        decryptEnvelope(envelope, {
          entity: 'OAuthAttempt',
          rowId: 'row-b',
          field: 'encryptedCodeVerifier',
        })
      ).toThrow();
    });
  });

  describe('ES256 JWT signing and verification', () => {
    it('signs and verifies valid ES256 session JWT', () => {
      const token = signSessionJwt({
        userId: '11111111-1111-4111-8111-111111111111',
        sessionId: '22222222-2222-4222-8222-222222222222',
      });
      const claims = verifySessionJwt(token);
      expect(claims.sub).toBe('11111111-1111-4111-8111-111111111111');
      expect(claims.sid).toBe('22222222-2222-4222-8222-222222222222');
    });

    it('rejects tampered JWT', () => {
      const token = signSessionJwt({
        userId: '11111111-1111-4111-8111-111111111111',
        sessionId: '22222222-2222-4222-8222-222222222222',
      });
      const tampered = `${token.slice(0, -4)}AAAA`;
      expect(() => verifySessionJwt(tampered)).toThrow();
    });
  });

  describe('Strict JSON parser preflight validator', () => {
    it('accepts valid JSON objects', () => {
      expect(() => inspectRawJsonForDuplicatesAndProto('{"a":1,"b":{"c":"ok"}}')).not.toThrow();
    });

    it('rejects duplicate object keys', () => {
      expect(() => inspectRawJsonForDuplicatesAndProto('{"a":1,"a":2}')).toThrow(/validation failed/i);
    });

    it('rejects prototype pollution keys', () => {
      expect(() => inspectRawJsonForDuplicatesAndProto('{"__proto__":{"admin":true}}')).toThrow(
        /validation failed/i
      );
      expect(() => inspectRawJsonForDuplicatesAndProto('{"constructor":{}}')).toThrow(
        /validation failed/i
      );
    });
  });

  describe('Stripe webhook signature verification & URL validation', () => {
    const webhookSecret = 'whsec_test_unit_secret_12345';
    const stripeSdk = new Stripe('sk_test_unit_dummy');
    const client = new StripeClient({ secretKey: 'sk_test_unit_dummy', webhookSecret });

    it('verifies a valid test-mode Stripe webhook signature', () => {
      const payload = JSON.stringify({
        id: 'evt_test_1',
        type: 'checkout.session.completed',
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'cs_test_1', mode: 'payment', metadata: { orderId: 'ord-1' } } },
      });
      const sig = stripeSdk.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
      });

      const event = client.verifyWebhookEvent(Buffer.from(payload, 'utf8'), sig);
      expect(event.id).toBe('evt_test_1');
      expect(event.livemode).toBe(false);
    });

    it('rejects live-mode webhook events with WRONG_PAYMENT_MODE', () => {
      const payload = JSON.stringify({
        id: 'evt_live_1',
        type: 'checkout.session.completed',
        livemode: true,
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'cs_live_1' } },
      });
      const sig = stripeSdk.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
      });

      expect(() => client.verifyWebhookEvent(Buffer.from(payload, 'utf8'), sig)).toThrow(
        /Live-mode webhook events are rejected/i
      );
    });

    it('validates Stripe Checkout host strictly', () => {
      expect(validateStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_123')).toBe(
        'https://checkout.stripe.com/c/pay/cs_test_123'
      );
      expect(() => validateStripeCheckoutUrl('https://evil.example.com/pay')).toThrow();
      expect(() => validateStripeCheckoutUrl('http://checkout.stripe.com/pay')).toThrow();
    });
  });

  describe('LLM input redaction & Gemini adapter', () => {
    it('redacts emails, phones, UUIDs, tokens, and Luhn-valid card numbers', () => {
      const raw =
        'Hi my email is alice@example.com, phone +1 555-234-5678, order 11111111-1111-4111-8111-111111111111, card 4242 4242 4242 4242';
      const { redacted, hadSensitive } = redactSensitiveInput(raw);
      expect(hadSensitive).toBe(true);
      expect(redacted).not.toContain('alice@example.com');
      expect(redacted).not.toContain('555-234-5678');
      expect(redacted).not.toContain('11111111-1111-4111-8111-111111111111');
      expect(redacted).not.toContain('4242 4242 4242 4242');
      expect(passesLuhn('4242424242424242')).toBe(true);
    });

    it('calls Gemini generateContent with header API key and structured JSON output', async () => {
      const mockFetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: 'Sign in with Google creates a customer account.',
                      citationIds: ['chunk-1'],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      }));

      const client = new LlmClient(
        {
          enabled: true,
          apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'test-gemini-key',
          model: 'gemini-2.5-flash',
          dailyBudgetCents: 500,
          timeoutMs: 5000,
        },
        mockFetch
      );

      const result = await client.generateGroundedAnswer({
        redactedQuestion: 'How do I sign in?',
        chunks: [
          {
            id: 'chunk-1',
            documentId: 'faq',
            version: '1.0',
            section: 'Sign in',
            content: 'Use Sign in with Google.',
          },
        ],
      });

      expect(result).toEqual({
        answer: 'Sign in with Google creates a customer account.',
        citationIds: ['chunk-1'],
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
      );
      expect(url).not.toContain('test-gemini-key');
      expect(init.headers['x-goog-api-key']).toBe('test-gemini-key');
      const body = JSON.parse(init.body);
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.systemInstruction.parts[0].text).toContain('APPROVED_EVIDENCE');
    });

    it('throws 503 AI_UNAVAILABLE when Gemini returns an error response', async () => {
      const mockFetch = jest.fn(async () => ({ ok: false, status: 500 }));
      const client = new LlmClient(
        {
          enabled: true,
          apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'test-gemini-key',
          model: 'gemini-2.5-flash',
          dailyBudgetCents: 500,
          timeoutMs: 5000,
        },
        mockFetch
      );

      await expect(
        client.generateGroundedAnswer({
          redactedQuestion: 'How do I sign in?',
          chunks: [],
        })
      ).rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' });
    });
  });
});
