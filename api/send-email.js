import { Resend } from 'resend';
import { randomUUID } from 'crypto';

const resend = new Resend(process.env.RESEND_API_KEY);
const ipRequests = new Map();

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkRateLimit(ip) {
  const now = Date.now();
  const hour = 3600000;

  if (!ipRequests.has(ip)) ipRequests.set(ip, []);
  const times = ipRequests.get(ip).filter(t => now - t < hour);
  ipRequests.set(ip, times);

  return times.length < 5;
}

async function sendEmailWithFallback(to, subject, html, replyTo) {
  try {
    return await resend.emails.send({
      from: process.env.CONTACT_FROM || 'noreply@aristeiaconsulting.de',
      to,
      replyTo,
      subject,
      html
    });
  } catch (err) {
    console.error('Email send failed:', { to: '***', subject, error: err.message });
    throw err;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

  try {
    const { firstName, lastName, email, company, role, phone, message, honeypot } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || randomUUID();

    if (honeypot) return res.status(200).json({ success: true });

    if (!firstName || !lastName || !email || !company || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    if (firstName.length > 80 || lastName.length > 80 || company.length > 120 || phone.length > 40) {
      return res.status(400).json({ error: 'Field too long' });
    }
    if (message && message.length > 2000) return res.status(400).json({ error: 'Message too long' });
    if (/http|https|www/.test(firstName) || /http|https|www/.test(lastName)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

    const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const name = `${firstName} ${lastName}`;

    const tableHtml = `
    <table style="width:100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px;">
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(email)}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Telefon:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(phone)}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Unternehmen:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(company)}</td></tr>
      ${role ? `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Rolle:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(role)}</td></tr>` : ''}
      ${message ? `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Nachricht:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;"><pre style="margin:0; white-space: pre-wrap;">${escapeHtml(message)}</pre></td></tr>` : ''}
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Zeitstempel:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${timestamp}</td></tr>
    </table>`;

    const confirmationHtml = `
    <h2 style="font-family: Arial, sans-serif;">Hallo ${escapeHtml(firstName)},</h2>
    <p style="font-family: Arial, sans-serif; line-height: 1.6;">danke für deine Anfrage. Sie ist bei mir angekommen.</p>
    <p style="font-family: Arial, sans-serif; line-height: 1.6;">Ich melde mich innerhalb von zwei Werktagen persönlich bei dir, damit wir einen Termin für das Erstgespräch finden. Es dauert 30 Minuten und läuft per Video.</p>
    <p style="font-family: Arial, sans-serif; line-height: 1.6;">Wenn du vorher eine Frage hast, antworte einfach auf diese Email.</p>
    <p style="font-family: Arial, sans-serif; line-height: 1.6;">Viele Grüße<br><strong>Timo Breimeier</strong></p>
    <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
    <p style="font-family: Arial, sans-serif; font-size: 12px; color: #666;">
      Timo Breimeier · ARISTEIA Consulting · Gesundheitsberatung für Unternehmer am Bodensee<br>
      Fitzenweiler 1, 88677 Markdorf · aristeiaconsulting.de
    </p>`;

    await sendEmailWithFallback(
      process.env.CONTACT_TO || 'timo@aristeiaconsulting.de',
      `Neue Anfrage: ${name}, ${company}`,
      tableHtml,
      email
    );

    await sendEmailWithFallback(
      email,
      'Deine Anfrage bei ARISTEIA',
      confirmationHtml,
      process.env.CONTACT_REPLY_TO || 'timo@aristeiaconsulting.de'
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Handler error:', { error: error.message });
    return res.status(500).json({ error: 'Request failed' });
  }
}
