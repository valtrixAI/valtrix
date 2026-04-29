const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_KEY;

async function supabase(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (method === 'PATCH' || method === 'DELETE') return null;
  return res.json();
}

// Hash simple (non-crypto) — suffisant pour un projet perso
function hashPw(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) { h = ((h << 5) - h) + pw.charCodeAt(i); h |= 0; }
  return h.toString(36);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code, firstname) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Valtrix <onboarding@resend.dev>',
      to: email,
      subject: 'Votre code de vérification Valtrix',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:2rem;">
          <h2 style="color:#a855f7;">Valtrix 🐺</h2>
          <p>Bonjour ${firstname} !</p>
          <p>Votre code de vérification :</p>
          <div style="font-size:2rem;font-weight:700;letter-spacing:8px;color:#a855f7;padding:1rem;background:#f5f5f7;border-radius:10px;text-align:center;">${code}</div>
          <p style="color:#888;font-size:.85rem;margin-top:1rem;">Ce code expire dans 10 minutes.</p>
        </div>
      `
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Email non envoyé : ${err}`);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, email, password, firstname, lastname, code } = req.body || {};
  const emailLower = email?.toLowerCase().trim();

  // ── INSCRIPTION ──
  if (action === 'register') {
    if (!emailLower || !password || !firstname) {
      return res.status(400).json({ error: 'Champs manquants' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe trop court (6 min)' });
    }

    const existing = await supabase(`/users?email=eq.${encodeURIComponent(emailLower)}&select=id`, 'GET');
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    const verifyCode = generateCode();
    const exp = Date.now() + 10 * 60 * 1000;

    // FIX CRITIQUE : stockage dans Supabase, pas en mémoire (les fonctions Vercel sont stateless)
    // ⚠️ Créer cette table dans Supabase :
    // CREATE TABLE verifications (
    //   email text PRIMARY KEY,
    //   code text NOT NULL,
    //   exp bigint NOT NULL,
    //   password text NOT NULL,
    //   firstname text NOT NULL,
    //   lastname text DEFAULT ''
    // );
    await fetch(`${SUPABASE_URL}/rest/v1/verifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        email: emailLower,
        code: verifyCode,
        exp,
        password: hashPw(password),
        firstname,
        lastname: lastname || ''
      })
    });

    try {
      await sendVerificationEmail(emailLower, verifyCode, firstname);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    return res.status(200).json({ success: true, message: 'Code envoyé !' });
  }

  // ── VÉRIFICATION CODE ──
  if (action === 'verify') {
    if (!emailLower || !code) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const rows = await supabase(`/verifications?email=eq.${encodeURIComponent(emailLower)}&select=*`, 'GET');
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Aucun code en attente pour cet email' });
    }

    const pending = rows[0];

    if (Date.now() > pending.exp) {
      await supabase(`/verifications?email=eq.${encodeURIComponent(emailLower)}`, 'DELETE');
      return res.status(400).json({ error: 'Code expiré, recommencez l\'inscription' });
    }
    if (pending.code !== code) {
      return res.status(400).json({ error: 'Code incorrect' });
    }

    const newUser = await supabase('/users', 'POST', {
      email: emailLower,
      password: pending.password,
      firstname: pending.firstname,
      lastname: pending.lastname || '',
      premium: false
    });

    // Nettoyer le code utilisé
    await supabase(`/verifications?email=eq.${encodeURIComponent(emailLower)}`, 'DELETE');

    if (!Array.isArray(newUser) || newUser.length === 0) {
      return res.status(500).json({ error: 'Erreur lors de la création du compte' });
    }

    return res.status(200).json({ success: true, user: newUser[0] });
  }

  // ── CONNEXION ──
  if (action === 'login') {
    if (!emailLower || !password) {
      return res.status(400).json({ error: 'Champs manquants' });
    }

    const users = await supabase(`/users?email=eq.${encodeURIComponent(emailLower)}&select=*`, 'GET');
    if (!Array.isArray(users) || users.length === 0 || users[0].password !== hashPw(password)) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    return res.status(200).json({ success: true, user: users[0] });
  }

  return res.status(400).json({ error: 'Action invalide' });
};
