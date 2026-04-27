const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

async function supabase(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

function hashPw(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) { h = ((h << 5) - h) + pw.charCodeAt(i); h |= 0; }
  return h.toString(36);
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Stockage temporaire des codes de vérification
const verificationCodes = {};

async function sendVerificationEmail(email, code, firstname) {
  await fetch('https://api.resend.com/emails', {
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
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 2rem;">
          <h2 style="background: linear-gradient(135deg, #a855f7, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Valtrix 🐺</h2>
          <p>Bonjour ${firstname} !</p>
          <p>Votre code de vérification est :</p>
          <div style="font-size: 2rem; font-weight: 700; letter-spacing: 8px; color: #a855f7; padding: 1rem; background: #f5f5f7; border-radius: 10px; text-align: center;">${code}</div>
          <p style="color: #888; font-size: .85rem;">Ce code expire dans 10 minutes.</p>
        </div>
      `
    })
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const { action, email, password, firstname, lastname, code } = JSON.parse(event.body || '{}');
  const emailLower = email?.toLowerCase();

  // ── INSCRIPTION ──
  if (action === 'register') {
    if (!email || !password || !firstname) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Champs manquants' }) };

    // Vérifier si email existe déjà
    const existing = await supabase(`/users?email=eq.${emailLower}&select=id`, 'GET');
    if (existing.length > 0) return { statusCode: 409, headers, body: JSON.stringify({ error: 'Cet email est déjà utilisé' }) };

    // Générer et envoyer le code
    const verifyCode = generateCode();
    verificationCodes[emailLower] = { code: verifyCode, exp: Date.now() + 10 * 60 * 1000, password: hashPw(password), firstname, lastname };
    await sendVerificationEmail(emailLower, verifyCode, firstname);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Code envoyé !' }) };
  }

  // ── VÉRIFICATION CODE ──
  if (action === 'verify') {
    const pending = verificationCodes[emailLower];
    if (!pending) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Aucun code en attente' }) };
    if (Date.now() > pending.exp) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code expiré' }) };
    if (pending.code !== code) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code incorrect' }) };

    // Créer le compte
    const user = await supabase('/users', 'POST', {
      email: emailLower,
      password: pending.password,
      firstname: pending.firstname,
      lastname: pending.lastname || '',
      premium: false
    });
    delete verificationCodes[emailLower];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user: user[0] }) };
  }

  // ── CONNEXION ──
  if (action === 'login') {
    const users = await supabase(`/users?email=eq.${emailLower}&select=*`, 'GET');
    if (!users.length || users[0].password !== hashPw(password)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Email ou mot de passe incorrect' }) };
    }
    const user = users[0];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, user }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action invalide' }) };
};
