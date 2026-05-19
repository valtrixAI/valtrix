const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RESEND_KEY = process.env.RESEND_KEY;

const hash = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h.toString(36);
};

const code6 = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendReset(email, firstname, code) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Valtrix <hello@aivaltrix.com>',
      to: email,
      subject: 'Réinitialiser ton mot de passe',
      html: `
        <div style="font-family:system-ui;padding:30px;max-width:480px;margin:auto">
          <h1 style="color:#a855f7;margin:0">Valtrix</h1>
          <p>Salut ${firstname},</p>
          <p>Code pour réinitialiser ton mot de passe :</p>
          <div style="font-size:36px;font-weight:800;letter-spacing:10px;text-align:center;background:#fee2e2;padding:20px;border-radius:12px;margin:20px 0;color:#dc2626">${code}</div>
          <p style="color:#6b7280;font-size:14px">Valide 10 minutes. Si ce n'est pas toi, ignore cet email.</p>
        </div>`
    })
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, email, code, newPassword } = body;
    const mail = email?.toLowerCase().trim();

    // ÉTAPE 1 : demander le code
    if (action === 'request') {
      const { data: user } = await supabase.from('users').select('firstname').eq('email', mail).maybeSingle();
      if (!user) throw new Error('Email introuvable');

      const resetCode = code6();
      const exp = Date.now() + 600000;

      await supabase.from('verifications').upsert({
        email: mail,
        code: resetCode,
        exp,
        password: 'reset' // marqueur
      });

      await sendReset(mail, user.firstname, resetCode);
      return res.json({ success: true });
    }

    // ÉTAPE 2 : vérifier code + changer mdp
    if (action === 'reset') {
      if (!newPassword || newPassword.length < 6) throw new Error('6 caractères min');
      
      const { data: v } = await supabase.from('verifications').select('*').eq('email', mail).maybeSingle();
      if (!v || v.password !== 'reset') throw new Error('Demande invalide');
      if (Date.now() > v.exp) throw new Error('Code expiré');
      if (v.code !== code) throw new Error('Code incorrect');

      await supabase.from('users').update({ password: hash(newPassword) }).eq('email', mail);
      await supabase.from('verifications').delete().eq('email', mail);
      
      return res.json({ success: true });
    }

    throw new Error('Action inconnue');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
};
