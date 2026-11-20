import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, phone, type, answers } = req.body;

    // Validierung
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Email-Text für Contact Form
    let emailContent = `
Neue Kontaktanfrage von der Website

Name: ${name}
Email: ${email}
Telefon: ${phone}

---
Diese Email wurde automatisch von deiner ARISTEIA Website gesendet.
    `;

    // Wenn es ein Kurz-Check Ergebnis ist
    if (type === 'check' && answers) {
      emailContent = `
Kurz-Check Ergebnis: ${answers.result}

Kontaktinformationen:
Name: ${name}
Email: ${email}
Telefon: ${phone}

Antworten:
- Schlaf: ${answers[0]}
- Training: ${answers[1]}
- Ernährung: ${answers[2]}
- Stress: ${answers[3]}
- Wasser: ${answers[4]}
- Fitness: ${answers[5]}
- Ziele: ${answers[6]}
- Unterstützung: ${answers[7]}

---
Diese Email wurde automatisch von deiner ARISTEIA Website gesendet.
      `;
    }

    // Email an dich senden
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'timo@aristeiaconsulting.de',
      subject: type === 'check' ? 'Kurz-Check Ergebnis von ' + name : 'Neue Kontaktanfrage von ' + name,
      html: emailContent.replace(/\n/g, '<br>'),
    });

    // Bestätigungs-Email an den Besucher senden
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: 'Danke für deine Anfrage - ARISTEIA',
      html: `
<h2>Danke, ${name}!</h2>
<p>Ich habe deine Anfrage erhalten und antworte innerhalb von 24 Stunden.</p>
<p>Viele Grüße<br>Timo</p>
      `,
    });

    return res.status(200).json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error sending email:', error);
    return res.status(500).json({ error: 'Error sending email: ' + error.message });
  }
}
