module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
    const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
    const RESEND_KEY = (process.env.RESEND_KEY || '').trim();

    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL ou KEY manquante');

    const supabase = async (path, method, body) => {
      const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
      return (method === 'PATCH' || method === 'DELETE') ? null : await r.json();
    };

    const hashPw = pw => { let h=0; for(let i=0;i<pw.length;i++){h=((h<<5)-h)+pw.charCodeAt(i);h|=0} return h.toString(36) };
    const code = () => Math.floor(100000 + Math.random()*900000).toString();

    const { action, email, password, firstname, lastname, code: userCode } = req.body || {};
    const emailL = email?.toLowerCase().trim();

    if (action === 'register') {
      if (!emailL || !password || !firstname) return res.status(400).json({ error: 'Champs manquants' });
      const ex = await supabase(`/users?email=eq.${encodeURIComponent(emailL)}&select=id`, 'GET');
      if (ex.length) return res.status(409).json({ error: 'Email dÃ©jÃ  utilisÃ©' });
      
      const verifyCode = code();
      await fetch(`${SUPABASE_URL}/rest/v1/verifications`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', apikey: SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, Prefer:'resolution=merge-duplicates' },
        body: JSON.stringify({ email: emailL, code: verifyCode, exp: Date.now()+600000, password: hashPw(password), firstname, lastname: lastname||'' })
      });
      
      // envoi email ignorÃ© si Ã©chec
      try { if(RESEND_KEY) await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Valtrix <onboarding@resend.dev>',to:emailL,subject:'Code',html:`<b>${verifyCode}</b>`})}); } catch{}
      
      return res.json({ success:true, debugCode: verifyCode });
    }

    if (action === 'verify') {
      const rows = await supabase(`/verifications?email=eq.${encodeURIComponent(emailL)}&select=*`, 'GET');
      if (!rows.length) return res.status(400).json({ error: 'Aucun code' });
      const p = rows[0];
      if (Date.now() > p.exp) return res.status(400).json({ error: 'ExpirÃ©' });
      if (p.code !== userCode) return res.status(400).json({ error: 'Incorrect' });
      const nu = await supabase('/users','POST',{ email:emailL, password:p.password, firstname:p.firstname, lastname:p.lastname, premium:false });
      await supabase(`/verifications?email=eq.${encodeURIComponent(emailL)}`,'DELETE');
      return res.json({ success:true, user:nu[0] });
    }

    if (action === 'login') {
      const u = await supabase(`/users?email=eq.${encodeURIComponent(emailL)}&select=*`,'GET');
      if (!u.length || u[0].password !== hashPw(password)) return res.status(401).json({ error: 'Identifiants invalides' });
      return res.json({ success:true, user:u[0] });
    }

    return res.status(400).json({ error: 'Action invalide' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
