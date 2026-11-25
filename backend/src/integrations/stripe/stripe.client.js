const Stripe = require('stripe');
const { config } = require('../../config/env');
const { AppError } = require('../../config/errors');

function validateStripeCheckoutUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_) {
    throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Invalid Checkout URL returned by payment provider.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'checkout.stripe.com' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443')
  ) {
    throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Checkout URL host validation failed.');
  }
  return urlString;
}

class StripeClient {
  constructor(stripeConfig = config.stripe, appOrigin = config.appOrigin) {
    this.stripeConfig = stripeConfig;
    this.appOrigin = appOrigin;
    this.sdk = stripeConfig.secretKey
      ? new Stripe(stripeConfig.secretKey, {
          timeout: 15_000,
          maxNetworkRetries: 0,
        })
      : null;
  }

  ensureConfigured() {
    if (!this.sdk) {
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Stripe test credentials are not configured.'
      );
    }
  }

  async createCheckoutSession({ order, expiresAtUnix, idempotencyKey }) {
    this.ensureConfigured();
    try {
      const session = await this.sdk.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: order.items.map((item) => ({
            quantity: item.quantity,
            price_data: {
              currency: 'usd',
              unit_amount: item.unitPrice,
              product_data: {
                name: item.name,
                metadata: { sku: item.sku },
              },
            },
          })),
          metadata: {
            orderId: order.id,
          },
          success_url: `${this.appOrigin}/account?orderId=${order.id}&payment=returned`,
          cancel_url: `${this.appOrigin}/checkout?orderId=${order.id}&payment=cancelled`,
          expires_at: expiresAtUnix,
        },
        { idempotencyKey }
      );

      validateStripeCheckoutUrl(session.url);
      return {
        id: session.id,
        url: session.url,
        expiresAt: new Date(session.expires_at * 1000),
        paymentStatus: session.payment_status,
        status: session.status,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Payment provider is temporarily unavailable.'
      );
    }
  }

  async retrieveCheckoutSession(sessionId) {
    this.ensureConfigured();
    try {
      return await this.sdk.checkout.sessions.retrieve(sessionId);
    } catch (_) {
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Unable to retrieve payment session from provider.'
      );
    }
  }

  async expireCheckoutSession(sessionId) {
    this.ensureConfigured();
    try {
      return await this.sdk.checkout.sessions.expire(sessionId);
    } catch (_) {
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Unable to expire payment session with provider.'
      );
    }
  }

  verifyWebhookEvent(rawBody, signatureHeader) {
    if (!signatureHeader || typeof signatureHeader !== 'string') {
      throw new AppError(400, 'WEBHOOK_INVALID', 'Missing Stripe-Signature header.');
    }
    const secrets = [
      this.stripeConfig.webhookSecret,
      this.stripeConfig.webhookSecretPrevious,
    ].filter(Boolean);

    if (secrets.length === 0) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Webhook secret is not configured.');
    }

    const verifierSdk = this.sdk || new Stripe('sk_test_webhook_verifier_placeholder');
    let event = null;
    for (const secret of secrets) {
      try {
        event = verifierSdk.webhooks.constructEvent(rawBody, signatureHeader, secret, 300);
        break;
      } catch (_) {
        // try next secret in rotation overlap
      }
    }

    if (!event) {
      throw new AppError(400, 'WEBHOOK_INVALID', 'Invalid webhook signature or timestamp.');
    }

    if (
      typeof event.id !== 'string' ||
      typeof event.type !== 'string' ||
      typeof event.livemode !== 'boolean' ||
      !Number.isInteger(event.created) ||
      !event.data ||
      typeof event.data.object !== 'object' ||
      event.data.object === null
    ) {
      throw new AppError(400, 'WEBHOOK_INVALID', 'Malformed Stripe event envelope.');
    }

    if (event.livemode === true) {
      throw new AppError(400, 'WRONG_PAYMENT_MODE', 'Live-mode webhook events are rejected in test mode.');
    }

    return event;
  }

  projectWebhookEvent(event) {
    const obj = event.data?.object || {};
    return {
      eventId: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
      sessionId: typeof obj.id === 'string' ? obj.id : null,
      mode: typeof obj.mode === 'string' ? obj.mode : null,
      paymentStatus: typeof obj.payment_status === 'string' ? obj.payment_status : null,
      amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
      currency: typeof obj.currency === 'string' ? obj.currency : null,
      orderId: typeof obj.metadata?.orderId === 'string' ? obj.metadata.orderId : null,
      paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : null,
    };
  }
}

module.exports = {
  StripeClient,
  validateStripeCheckoutUrl,
};
