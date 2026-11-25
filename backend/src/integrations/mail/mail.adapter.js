const nodemailer = require('nodemailer');
const { config } = require('../../config/env');

function buildAuthActionUrl(purpose, rawToken, appOrigin = config.appOrigin) {
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    throw new Error('Invalid auth action token format.');
  }
  let parsed;
  try {
    parsed = new URL(appOrigin);
  } catch (_) {
    throw new Error('Invalid configured APP_ORIGIN.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('APP_ORIGIN must use http or https.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('APP_ORIGIN must not contain credentials.');
  }
  const cleanOrigin = `${parsed.protocol}//${parsed.host}`;

  if (purpose === 'VERIFY_EMAIL') {
    return `${cleanOrigin}/verify-email#token=${rawToken}`;
  }
  if (purpose === 'RESET_PASSWORD') {
    return `${cleanOrigin}/reset-password#token=${rawToken}`;
  }
  throw new Error(`Unsupported auth action purpose: ${purpose}`);
}

function renderAuthMail({ template, payload, appOrigin = config.appOrigin }) {
  if (!payload || typeof payload.to !== 'string' || !payload.to) {
    throw new Error('Mail payload is missing recipient.');
  }

  if (template === 'VERIFY_EMAIL') {
    const actionUrl = buildAuthActionUrl('VERIFY_EMAIL', payload.token, appOrigin);
    return {
      to: payload.to,
      subject: 'Verify your email address — Kanto',
      text: [
        'You requested to create a Kanto account with this email address.',
        '',
        'Open the link below within 30 minutes to complete your registration:',
        actionUrl,
        '',
        'If you did not request this, you can safely ignore this email.',
      ].join('\n'),
      actionUrl,
    };
  }

  if (template === 'RESET_PASSWORD') {
    const actionUrl = buildAuthActionUrl('RESET_PASSWORD', payload.token, appOrigin);
    return {
      to: payload.to,
      subject: 'Reset your password — Kanto',
      text: [
        'We received a request to reset your Kanto account password.',
        '',
        'Open the link below within 15 minutes to set a new password:',
        actionUrl,
        '',
        'If you did not request a password reset, you can safely ignore this email.',
      ].join('\n'),
      actionUrl,
    };
  }

  if (template === 'PASSWORD_CHANGED') {
    return {
      to: payload.to,
      subject: 'Your Kanto password was changed',
      text: [
        'Your Kanto account password was recently updated and all previous sessions were signed out.',
        '',
        'If you did not make this change, contact support immediately and secure your email account.',
      ].join('\n'),
      actionUrl: null,
    };
  }

  throw new Error(`Unsupported auth mail template: ${template}`);
}

class FakeMailAdapter {
  constructor() {
    this.messages = [];
    this.failNextCount = 0;
    this.failAlways = false;
    this.failCode = 'SMTP_TRANSIENT_ERROR';
  }

  setFailureMode({ failNextCount = 0, failAlways = false, failCode = 'SMTP_TRANSIENT_ERROR' } = {}) {
    this.failNextCount = failNextCount;
    this.failAlways = failAlways;
    this.failCode = failCode;
  }

  clear() {
    this.messages = [];
    this.failNextCount = 0;
    this.failAlways = false;
  }

  getMessages() {
    return this.messages.slice();
  }

  async sendMail({ from, to, subject, text, dedupeKey, template }) {
    if (this.failAlways || this.failNextCount > 0) {
      if (this.failNextCount > 0) this.failNextCount -= 1;
      const err = new Error('Simulated mail delivery failure');
      err.code = this.failCode;
      throw err;
    }

    const record = {
      from,
      to,
      subject,
      text,
      dedupeKey,
      template,
      sentAt: new Date().toISOString(),
    };
    this.messages.push(record);
    if (process.env.NODE_ENV === 'development') {
      console.log(
        [
          '',
          '================ [DEV MAIL PREVIEW] ================',
          `To:      ${to}`,
          `From:    ${from}`,
          `Subject: ${subject}`,
          '----------------------------------------------------',
          text,
          '====================================================',
          '',
        ].join('\n')
      );
    }
    return { messageId: `fake-${dedupeKey || Date.now()}` };
  }
}

class SmtpMailAdapter {
  constructor(mailConfig = config.mail) {
    this.mailConfig = mailConfig;
    this.transporter = null;
  }

  _getTransporter() {
    if (!this.transporter) {
      if (!this.mailConfig.smtpHost) {
        const err = new Error('SMTP host is not configured.');
        err.code = 'SMTP_NOT_CONFIGURED';
        throw err;
      }
      this.transporter = nodemailer.createTransport({
        host: this.mailConfig.smtpHost,
        port: this.mailConfig.smtpPort,
        secure: this.mailConfig.smtpSecure,
        auth:
          this.mailConfig.smtpUser && this.mailConfig.smtpPass
            ? { user: this.mailConfig.smtpUser, pass: this.mailConfig.smtpPass }
            : undefined,
        connectionTimeout: this.mailConfig.timeoutMs,
        greetingTimeout: this.mailConfig.timeoutMs,
        socketTimeout: this.mailConfig.timeoutMs,
      });
    }
    return this.transporter;
  }

  async sendMail({ from, to, subject, text, dedupeKey }) {
    const transporter = this._getTransporter();
    const info = await transporter.sendMail({
      from: from || this.mailConfig.from,
      to,
      subject,
      text,
      headers: dedupeKey ? { 'X-Idempotency-Key': dedupeKey } : undefined,
    });
    return { messageId: info.messageId };
  }
}

function createMailAdapter(mailConfig = config.mail) {
  if (mailConfig.transport === 'smtp') {
    return new SmtpMailAdapter(mailConfig);
  }
  return new FakeMailAdapter();
}

module.exports = {
  buildAuthActionUrl,
  renderAuthMail,
  FakeMailAdapter,
  SmtpMailAdapter,
  createMailAdapter,
};
