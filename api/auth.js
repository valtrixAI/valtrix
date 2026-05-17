const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RESEND_KEY = process.env.RESEND_KEY;

// hash simple
const hash = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h.toString(36);
};

const code6 = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendCode(email, firstname, code) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Valtrix <hello@aivaltrix.com>',
      to: email,
      subject: 'Code Valtrix',
      html: `
        <div style="font-family:system-ui;padding:30px;max-width:480px;margin:auto">
          <h1 style="color:#a855f7;margin:0">Valtrix</h1>
          <p>Salut ${firstname},</p>
          <p>Voici ton code :</p>
          <div style="font-size:36px;font-weight:800;letter-spacing:10px;text-align:center;background:#f3f4f6;padding:20px;border-radius:12px;margin:20px 0">${code}</div>
          <p style="color:#6b7280;font-size:14px">Valide 10 minutes.</p>
        </div>`
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, email, password, firstname, lastname, code } = body;
    const mail = email?.toLowerCase().trim();

    // REGISTER
    if (action === 'register') {
      if (!mail || !password || !firstname) throw new Error('Champs manquants');
      if (password.length < 6) throw new Error('6 caractères min');

      const { data: exist } = await supabase.from('users').select('id').eq('email', mail).maybeSingle();
      if (exist) throw new Error('Email déjà utilisé');

      const verifyCode = code6();
      const exp = Date.now() + 600000;

      await supabase.from('verifications').upsert({
        email: mail,
        code: verifyCode,
        exp,
        password: hash(password),
        firstname,
        lastname: lastname || ''
      });

      await sendCode(mail, firstname, verifyCode);
      return res.json({ success: true });
    }

    // VERIFY
    if (action === 'verify') {
      const { data: v } = await supabase.from('verifications').select('*').eq('email', mail).maybeSingle();
      if (!v) throw new Error('Aucun code');
      if (Date.now() > v.exp) throw new Error('Code expiré');
      if (v.code !== code) throw new Error('Code incorrect');

      const { data: user } = await supabase.from('users').insert({
        email: mail,
        password: v.password,
        firstname: v.firstname,
        lastname: v.lastname,
        premium: false
      }).select().single();

      await supabase.from('verifications').delete().eq('email', mail);
      return res.json({ success: true, user });
    }

    // LOGIN
    if (action === 'login') {
      const { data: user } = await supabase.from('users').select('*').eq('email', mail).maybeSingle();
      if (!user || user.password !== hash(password)) throw new Error('Identifiants incorrects');
      return res.json({ success: true, user });
    }

    throw new Error('Action inconnue');
    
  } catch (e) {
    console.error(e);
    return res.status(400).json({ error: e.message });
  }
};
