module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const RESEND_KEY = process.env.RESEND_KEY;

    if (!SUPABASE_URL ||!SUPABASE_KEY) {
      throw new Error('Variables Supabase manquantes sur Vercel');
    }

    async function supabase(path, method, body) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: method === 'POST'? 'return=representation' : 'return=minimal'
        },
        body: body? JSON.stringify(body) : undefined
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Supabase ${r.status}: ${txt}`);
      }
      if (method === 'PATCH' || method === 'DELETE') return null;
      return r.json();
    }

    const hashPw = (pw) => { let h=0; for(let i=0;i<pw.length;i++){h=((h<<5)-h)+pw.charCodeAt(i);h|=0} return h.toString(36) };
    const generateCode = () => Math.floor(100000 + Math.random()*900000).toString();

    const { action, email, password, firstname, lastname, code } = req.body || {};
    const emailLower = email?.toLowerCase().trim();

    if (action === 'register') {
      if (!emailLower ||!password ||!firstname) return res.status(400).json({ error: 'Champs manquants' });

      const existing = await supabase(`/users?email=eq.${encodeURIComponent(emailLower)}&select=id`, 'GET');
      if (existing.length > 0) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

      const verifyCode = generateCode();
      const exp = Date.now() + 10*60*1000;

      await fetch(`${SUPABASE_URL}/rest/v1/verifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ email: emailLower, code: verifyCode, exp, password: hashPw(password), firstname, lastname: lastname||'' })
      });

      try {
        if (RESEND_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Valtrix <onboarding@resend.dev>',
              to: emailLower,
              subject: 'Code Valtrix',
              html: `<p>Code: <b>${verifyCode}</b></p>`
            })
          });
        }
      } catch(e) {}

      return res.status(200).json({ success: true, debugCode: verifyCode });
    }

    if (action === 'verify') {
      const rows = await supabase(`/verifications?email=eq.${encodeURIComponent(emailLower)}&select=*`, 'GET');
      if (!rows.length) return res.status(400).json({ error: 'Aucun code en attente' });
      const p = rows[0];
      if (Date.now() > p.exp) return res.status(400).json({ error: 'Code expiré' });
      if (p.code!== code) return res.status(400).json({ error: 'Code incorrect' });

      const newUser = await supabase('/users', 'POST', { email: emailLower, password: p.password, firstname: p.firstname, lastname: p.lastname||'', premium: false });
      await supabase(`/verifications?email=eq.${encodeURIComponent(emailLower)}`, 'DELETE');
      return res.status(200).json({ success: true, user: newUser[0] });
    }

    if (action === 'login') {
      const users = await supabase(`/users?email=eq.${encodeURIComponent(emailLower)}&select=*`, 'GET');
      if (!users.length || users[0].password!== hashPw(password)) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return res.status(200).json({ success: true, user: users[0] });
    }

    return res.status(400).json({ error: 'Action invalide' });

  } catch (err) {
    console.error('AUTH ERROR:', err);
    return res.status(500).json({ error: err.message });
  }
};
