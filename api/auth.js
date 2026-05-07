const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const RESEND_KEY = process.env.RESEND_KEY;

function hashPw(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) { h = ((h << 5) - h) + pw.charCodeAt(i); h |= 0; }
  return h.toString(36);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail(email, code, firstname) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Valtrix <onboarding@resend.dev>',
      to: email,
      subject: 'Votre code de vérification Valtrix',
      html: `<div style="font-family:sans-serif;padding:2rem;"><h2 style="color:#a855f7;">Valtrix 🐺</h2><p>Bonjour ${firstname} !</p><p>Votre code :</p><div style="font-size:2rem;font-weight:700;letter-spacing:8px;color:#a855f7;padding:1rem;background:#f5f5f7;border-radius:10px;text-align:center;">${code}</div><p style="color:#888;font-size:.85rem;">Expire dans 10 minutes.</p></div>`
    })
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { action, email, password, firstname, lastname, code } = body || {};
  const emailLower = email?.toLowerCase().trim();

  // ── INSCRIPTION ──
  if (action === 'register') {
    if (!emailLower || !password || !firstname) return res.status(400).json({ error: 'Champs manquants' });
    if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 min)' });

    const { data: existing } = await supabase.from('users').select('id').eq('email', emailLower).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    const verifyCode = generateCode();
    const exp = Date.now() + 10 * 60 * 1000;

    await supabase.from('verifications').upsert({
      email: emailLower, code: verifyCode, exp,
      password: hashPw(password), firstname, lastname: lastname || ''
    });

    await sendEmail(emailLower, verifyCode, firstname);
    return res.status(200).json({ success: true });
  }

  // ── VÉRIFICATION ──
  if (action === 'verify') {
    const { data: pending } = await supabase.from('verifications').select('*').eq('email', emailLower).maybeSingle();
    if (!pending) return res.status(400).json({ error: 'Aucun code en attente' });
    if (Date.now() > pending.exp) return res.status(400).json({ error: 'Code expiré' });
    if (pending.code !== code) return res.status(400).json({ error: 'Code incorrect' });

    const { data: newUser } = await supabase.from('users').insert({
      email: emailLower, password: pending.password,
      firstname: pending.firstname, lastname: pending.lastname || '', premium: false
    }).select().single();

    await supabase.from('verifications').delete().eq('email', emailLower);
    return res.status(200).json({ success: true, user: newUser });
  }

  // ── CONNEXION ──
  if (action === 'login') {
    const { data: user } = await supabase.from('users').select('*').eq('email', emailLower).maybeSingle();
    if (!user || user.password !== hashPw(password)) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    return res.status(200).json({ success: true, user });
  }

  return res.status(400).json({ error: 'Action invalide' });
};
