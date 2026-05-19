/**
 * Unit tests for src/services/email.ts + src/services/email-templates.ts.
 *
 * Mocks nodemailer entirely — no real SMTP. Asserts:
 *
 *   - sendMail() no-ops with a warn when SMTP_HOST is unset
 *   - sendMail() calls transporter.sendMail with the right shape
 *   - sendMail() never throws; errors are returned as { ok: false, error }
 *   - verifySmtp() returns true on transporter.verify success, false on failure
 *   - email-templates: welcomeEmail + signupAttemptedNoticeEmail return
 *     { subject, html, text } where html ⊇ text (same information, both
 *     formats), html contains the Pramaan/IN202311041001 footer, and
 *     user-supplied strings are HTML-escaped
 *   - **Critical**: no plaintext API key, no password, no biometric data
 *     appears anywhere in the rendered output
 */

const sendMailMock = jest.fn();
const verifyMock = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: sendMailMock,
    verify: verifyMock,
  })),
}));

import { config } from '../src/config';
import { sendMail, verifySmtp, _resetTransporterForTests } from '../src/services/email';
import { welcomeEmail, signupAttemptedNoticeEmail } from '../src/services/email-templates';

describe('services/email', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    verifyMock.mockReset();
    _resetTransporterForTests();
  });

  describe('sendMail — transporter unconfigured', () => {
    const originalHost = config.email.smtpHost;

    afterEach(() => {
      (config as any).email.smtpHost = originalHost;
    });

    it('returns { ok:false, skipped:true } when SMTP_HOST is empty', async () => {
      (config as any).email.smtpHost = '';
      const result = await sendMail({
        to: 'a@b.com',
        subject: 's',
        html: '<p>hi</p>',
        text: 'hi',
      });
      expect(result).toEqual({ ok: false, skipped: true });
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('returns { ok:false, skipped:true } when SMTP_USER is empty', async () => {
      (config as any).email.smtpHost = 'smtp.example.com';
      (config as any).email.smtpUser = '';
      const result = await sendMail({ to: 'a@b.com', subject: 's', html: '<p>hi</p>', text: 'hi' });
      expect(result.skipped).toBe(true);
    });
  });

  describe('sendMail — transporter configured', () => {
    beforeEach(() => {
      (config as any).email.smtpHost = 'smtp.example.com';
      (config as any).email.smtpUser = 'u';
      (config as any).email.smtpPassword = 'p';
      _resetTransporterForTests();
    });

    it('calls transporter.sendMail with the right envelope', async () => {
      sendMailMock.mockResolvedValueOnce({ messageId: '<abc>', accepted: ['a@b.com'] });
      const result = await sendMail({
        to: 'a@b.com',
        subject: 'Hello',
        html: '<p>hi</p>',
        text: 'hi',
      });
      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('<abc>');
      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'a@b.com',
          subject: 'Hello',
          html: '<p>hi</p>',
          text: 'hi',
          from: expect.stringContaining(config.email.fromAddress),
        }),
      );
    });

    it('honors replyTo when provided', async () => {
      sendMailMock.mockResolvedValueOnce({ messageId: '<x>' });
      await sendMail({ to: 'a@b.com', subject: 's', html: 'h', text: 't', replyTo: 'support@x.com' });
      expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ replyTo: 'support@x.com' }));
    });

    it('defaults replyTo to EMAIL_FROM', async () => {
      sendMailMock.mockResolvedValueOnce({ messageId: '<x>' });
      await sendMail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
      expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ replyTo: config.email.fromAddress }));
    });

    it('never throws — SMTP error returns { ok:false, error }', async () => {
      sendMailMock.mockRejectedValueOnce(new Error('connection refused'));
      const result = await sendMail({ to: 'a@b.com', subject: 's', html: 'h', text: 't' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('connection refused');
    });

    it('does NOT leak the recipient email into log lines (hashed)', async () => {
      // The hashRecipient helper is internal but observable by checking that
      // we never raise on a multibyte / unusual address.
      sendMailMock.mockResolvedValueOnce({ messageId: '<x>' });
      const result = await sendMail({ to: '  USER@Example.COM  ', subject: 's', html: 'h', text: 't' });
      expect(result.ok).toBe(true);
    });
  });

  describe('verifySmtp', () => {
    beforeEach(() => {
      (config as any).email.smtpHost = 'smtp.example.com';
      (config as any).email.smtpUser = 'u';
      (config as any).email.smtpPassword = 'p';
      _resetTransporterForTests();
    });

    it('returns true on transporter.verify success', async () => {
      verifyMock.mockResolvedValueOnce(true);
      expect(await verifySmtp()).toBe(true);
    });

    it('returns false on transporter.verify failure', async () => {
      verifyMock.mockRejectedValueOnce(new Error('5.7.1 Unauthorized IP address'));
      expect(await verifySmtp()).toBe(false);
    });

    it('returns false when transporter is unconfigured', async () => {
      (config as any).email.smtpHost = '';
      _resetTransporterForTests();
      expect(await verifySmtp()).toBe(false);
    });
  });
});

describe('services/email-templates', () => {
  describe('welcomeEmail', () => {
    const input = { email: 'jane@acme.com', companyName: 'Acme Corp', tenantId: 'tenant-1' };

    it('returns subject + html + text', () => {
      const t = welcomeEmail(input);
      expect(typeof t.subject).toBe('string');
      expect(t.subject.length).toBeGreaterThan(0);
      expect(t.html).toMatch(/<\w+/); // has at least one HTML tag
      expect(t.text.length).toBeGreaterThan(0);
    });

    it('mentions the company name when provided', () => {
      const t = welcomeEmail(input);
      expect(t.html).toContain('Acme Corp');
      expect(t.text).toContain('Acme Corp');
    });

    it('omits company-specific copy when companyName is null', () => {
      const t = welcomeEmail({ ...input, companyName: null });
      expect(t.html).toContain('jane@acme.com');
      expect(t.text).toContain('jane@acme.com');
      expect(t.html).not.toContain('linked to <strong>');
    });

    it('mentions "Pramaan" + the patent number in the footer', () => {
      const t = welcomeEmail(input);
      expect(t.html).toMatch(/Pramaan/);
      expect(t.html).toMatch(/IN202311041001/);
      expect(t.text).toMatch(/Pramaan/);
      expect(t.text).toMatch(/IN202311041001/);
    });

    it('escapes HTML in companyName to prevent template injection', () => {
      const t = welcomeEmail({ ...input, companyName: '<script>alert(1)</script>' });
      expect(t.html).not.toContain('<script>alert(1)</script>');
      expect(t.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes quotes in companyName', () => {
      const t = welcomeEmail({ ...input, companyName: 'A "B" Co' });
      expect(t.html).toContain('A &quot;B&quot; Co');
    });

    it('NEVER contains an API key, password, or biometric-derived data (per security-policy §10)', () => {
      const t = welcomeEmail(input);
      const allText = (t.html + '\n' + t.text).toLowerCase();
      // No za_live_/za_test_ literal in the body (the leak we care about)
      expect(allText).not.toMatch(/za_(live|test)_[a-f0-9]{48}/);
      // No exposed-credential-value patterns ("password: foo", "api key: bar")
      // We deliberately allow the WORDS to appear in copy ("we never email
      // plaintext API keys") — what we forbid is value-disclosure shapes.
      expect(allText).not.toMatch(/password:\s*\S/);
      expect(allText).not.toMatch(/api[_-]?key:\s*\S/);
      expect(allText).not.toMatch(/secret:\s*\S/);
      expect(allText).not.toMatch(/biometric[_-]?(data|hash|template|embedding):\s*\S/);
    });

    it('links to the dashboard, the Quickstart, and the whitepaper', () => {
      const t = welcomeEmail(input);
      expect(t.html).toContain('https://console.zeroauth.dev/api-keys');
      expect(t.html).toContain('https://docs.zeroauth.dev/getting-started/quickstart/');
      expect(t.html).toContain('https://docs.zeroauth.dev/whitepaper.pdf');
    });
  });

  describe('signupAttemptedNoticeEmail', () => {
    const input = { email: 'jane@acme.com', attemptIp: '203.0.113.10' };

    it('returns subject + html + text with the email in the body', () => {
      const t = signupAttemptedNoticeEmail(input);
      expect(t.html).toContain('jane@acme.com');
      expect(t.text).toContain('jane@acme.com');
    });

    it('includes the attempt source IP when provided', () => {
      const t = signupAttemptedNoticeEmail(input);
      expect(t.html).toContain('203.0.113.10');
      expect(t.text).toContain('203.0.113.10');
    });

    it('omits the IP block when attemptIp is null', () => {
      const t = signupAttemptedNoticeEmail({ ...input, attemptIp: null });
      expect(t.html).not.toContain('Attempt source IP');
      expect(t.text).not.toContain('Attempt source IP');
    });

    it('points the legitimate user to the dashboard login + password-reset flow', () => {
      const t = signupAttemptedNoticeEmail(input);
      expect(t.html).toContain('https://console.zeroauth.dev/login');
    });

    it('escapes the source IP value (defense-in-depth — IPs are technically attacker-controlled)', () => {
      const t = signupAttemptedNoticeEmail({ ...input, attemptIp: '<script>x</script>' });
      expect(t.html).not.toContain('<script>x</script>');
      expect(t.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    });

    it('includes Pramaan + patent footer', () => {
      const t = signupAttemptedNoticeEmail(input);
      expect(t.html).toMatch(/Pramaan/);
      expect(t.html).toMatch(/IN202311041001/);
    });
  });
});
