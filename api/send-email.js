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
    const { type, firstName, lastName, email, company, role, phone, message, name, answers, persona, honeypot } = req.body;
    const idempotencyKey = req.headers['idempotency-key'] || randomUUID();

    if (honeypot) return res.status(200).json({ success: true });
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

    if (type === 'check') {
      if (!name || !email || !phone) return res.status(400).json({ error: 'Missing required fields' });
      if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email' });

      const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
      const questions = ['Was beschreibt dich am besten?', 'Wie viel Energie hast du an einem normalen Arbeitstag um 15 Uhr noch?', 'Wie erholt startest du in den Tag?', 'Wie sieht Bewegung bei dir gerade aus?', 'Was würde dir am meisten helfen?', 'Was soll in den nächsten 12 Monaten anders sein?', 'Wann möchtest du starten?'];
      if (!Array.isArray(answers) || answers.length !== questions.length) return res.status(400).json({ error: 'Invalid answers' });
      const resultText = { EINSTIEG: 'Einstieg', STRUKTUR: 'Struktur', ERHOLUNG: 'Erholung' }[persona] || '-';

      let answersHtml = questions.map((q, i) => `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>F${i+1}: ${q}</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(String(answers[i] || '-'))}</td></tr>`).join('');

      const checkHtml = `
      <table style="width:100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(name)}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(email)}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Telefon:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;" colspan="2"><strong style="color: #333;">ANTWORTEN:</strong></td></tr>
        ${answersHtml}
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Ergebnis (intern):</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>${resultText}</strong></td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Zeitstempel:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${timestamp}</td></tr>
      </table>`;

      await sendEmailWithFallback(process.env.CONTACT_TO || 'timo@aristeiaconsulting.de', `Kurz-Check Ergebnis: ${name} (${resultText})`, checkHtml, email);
      await sendEmailWithFallback(email, 'Dein Kurz-Check bei ARISTEIA', `<h2>Hallo ${escapeHtml(name)},</h2><p>danke für deine Antworten im Kurz-Check. Sie sind bei mir angekommen.</p><p>Ich melde mich innerhalb von zwei Werktagen persönlich bei dir, um ein Erstgespräch zu vereinbaren.</p><p>Viele Grüße<br><strong>Timo Breimeier</strong></p>`, process.env.CONTACT_REPLY_TO || 'timo@aristeiaconsulting.de');
    } else {
      if (!firstName || !lastName || !email || !company || !phone) return res.status(400).json({ error: 'Missing required fields' });
      if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email' });
      if (firstName.length > 80 || lastName.length > 80 || company.length > 120 || phone.length > 40) return res.status(400).json({ error: 'Field too long' });
      if (message && message.length > 2000) return res.status(400).json({ error: 'Message too long' });
      if (/http|https|www/.test(firstName) || /http|https|www/.test(lastName)) return res.status(400).json({ error: 'Invalid input' });

      const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
      const fullName = `${firstName} ${lastName}`;

      const contactHtml = `
      <table style="width:100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(email)}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Telefon:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Unternehmen:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(company)}</td></tr>
        ${role ? `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Rolle:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${escapeHtml(role)}</td></tr>` : ''}
        ${message ? `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Nachricht:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;"><pre style="margin:0; white-space: pre-wrap;">${escapeHtml(message)}</pre></td></tr>` : ''}
        <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Zeitstempel:</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${timestamp}</td></tr>
      </table>`;

      const confirmationHtml = `<h2 style="font-family: Arial, sans-serif;">Hallo ${escapeHtml(firstName)},</h2><p style="font-family: Arial, sans-serif; line-height: 1.6;">danke für deine Anfrage. Sie ist bei mir angekommen.</p><p style="font-family: Arial, sans-serif; line-height: 1.6;">Ich melde mich innerhalb von zwei Werktagen persönlich bei dir.</p><p style="font-family: Arial, sans-serif; line-height: 1.6;">Viele Grüße<br><strong>Timo Breimeier</strong></p>`;

      await sendEmailWithFallback(process.env.CONTACT_TO || 'timo@aristeiaconsulting.de', `Neue Anfrage: ${fullName}, ${company}`, contactHtml, email);
      await sendEmailWithFallback(email, 'Deine Anfrage bei ARISTEIA', confirmationHtml, process.env.CONTACT_REPLY_TO || 'timo@aristeiaconsulting.de');
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Handler error:', { error: error.message });
    return res.status(500).json({ error: 'Request failed' });
  }
}
