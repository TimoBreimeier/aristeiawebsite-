import { Resend } from 'resend';

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

  if (times.length >= 5) return false;
  times.push(now);
  return true;
}

async function sendEmailWithFallback(to, subject, html, replyTo) {
  try {
    return await resend.emails.send({
      from: process.env.CONTACT_FROM || 'noreply@aristeiaconsulting.de',
      to,
      reply_to: replyTo,
      subject,
      html
    });
  } catch (err) {
    console.error('Email send failed:', { to: '***', subject, error: err.message });
    throw err;
  }
}

const QUESTIONS = ['Was beschreibt dich am besten?', 'Wie viel Energie hast du an einem normalen Arbeitstag um 15 Uhr noch?', 'Wie erholt startest du in den Tag?', 'Wie sieht Bewegung bei dir gerade aus?', 'Was würde dir am meisten helfen?', 'Was soll in den nächsten 12 Monaten anders sein?', 'Wann möchtest du starten?'];
const PERSONAS = { EINSTIEG: 'Einstieg', STRUKTUR: 'Struktur', ERHOLUNG: 'Erholung' };
const str = v => (typeof v === 'string' ? v.trim() : '');
const row = (label, value) => `<tr><td style="padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top;"><strong>${label}</strong></td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${value}</td></tr>`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

  try {
    const body = req.body || {};
    const name = str(body.name), email = str(body.email), phone = str(body.phone), company = str(body.company), role = str(body.role), message = str(body.message);

    if (body.honeypot) return res.status(200).json({ success: true });
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' });

    if (!name || !email) return res.status(400).json({ error: 'Missing required fields' });
    if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    if (name.length > 120 || email.length > 200 || company.length > 120 || role.length > 120 || phone.length > 40) return res.status(400).json({ error: 'Field too long' });
    if (message.length > 2000) return res.status(400).json({ error: 'Message too long' });
    if (/http|https|www/.test(name)) return res.status(400).json({ error: 'Invalid input' });

    const check = body.check;
    const hasCheck = !!check && Array.isArray(check.answers) && check.answers.length === QUESTIONS.length
      && check.answers.every(a => typeof a === 'string' && a.length <= 200) && PERSONAS[check.persona];

    const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    let html = '<table style="width:100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px;">'
      + row('Name:', escapeHtml(name))
      + row('Email:', escapeHtml(email))
      + (phone ? row('Telefon:', escapeHtml(phone)) : '')
      + (company ? row('Unternehmen:', escapeHtml(company)) : '')
      + (role ? row('Rolle:', escapeHtml(role)) : '')
      + (message ? row('Nachricht:', `<pre style="margin:0; white-space: pre-wrap; font-family: inherit;">${escapeHtml(message)}</pre>`) : '');
    if (hasCheck) {
      html += '<tr><td style="padding: 16px 8px 8px; border-bottom: 1px solid #ddd;" colspan="2"><strong>KURZ-CHECK (mit Einwilligung)</strong></td></tr>'
        + QUESTIONS.map((q, i) => row(`F${i + 1}: ${q}`, escapeHtml(check.answers[i]))).join('')
        + row('Ergebnis (intern):', `<strong>${PERSONAS[check.persona]}</strong>`);
    }
    html += row('Zeitstempel:', timestamp) + '</table>';

    const confirmationHtml = `<h2 style="font-family: Arial, sans-serif;">Hallo ${escapeHtml(name)},</h2><p style="font-family: Arial, sans-serif; line-height: 1.6;">danke für deine Anfrage. Sie ist bei mir angekommen.</p><p style="font-family: Arial, sans-serif; line-height: 1.6;">Ich melde mich innerhalb von 24 Stunden an Werktagen persönlich bei dir.</p><p style="font-family: Arial, sans-serif; line-height: 1.6;">Viele Grüße<br><strong>Timo Breimeier</strong></p>`;

    const subject = `Neue Anfrage: ${name}${company ? ', ' + company : ''}${hasCheck ? ' (mit Kurz-Check)' : ''}`;
    await sendEmailWithFallback(process.env.CONTACT_TO || 'timo@aristeiaconsulting.de', subject, html, email);
    await sendEmailWithFallback(email, 'Deine Anfrage bei ARISTEIA', confirmationHtml, process.env.CONTACT_REPLY_TO || 'timo@aristeiaconsulting.de');

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Handler error:', { error: error.message });
    return res.status(500).json({ error: 'Request failed' });
  }
}
