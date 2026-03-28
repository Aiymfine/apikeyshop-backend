const nodemailer = require('nodemailer');

function buildTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      : undefined
  });
}

const transport = buildTransport();

async function sendEmail({ to, subject, text, html }) {
  if (!transport) {
    console.log('[email] SMTP not configured, skipping send:', { to, subject });
    return { skipped: true };
  }

  const from = process.env.EMAIL_FROM || 'noreply@apikeyshop.local';
  const info = await transport.sendMail({ from, to, subject, text, html });
  return { skipped: false, messageId: info.messageId };
}

module.exports = { sendEmail };
