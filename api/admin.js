const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = 'charlyvangrim@gmail.com';

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, email, adminEmail, amount, value } = req.body || {};

  if (adminEmail !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  if (action === 'makePremium') {
    await supabase(`/users?email=eq.${encodeURIComponent(adminEmail)}`, 'PATCH', { premium: true });
    await supabase(`/users_pro?email=eq.${encodeURIComponent(adminEmail)}`, 'PATCH', { is_premium: true });
    return res.status(200).json({ success: true });
  }

  if (action === 'addCredits') {
    if (!email || !amount) return res.status(400).json({ error: 'email et amount requis' });
    const rows = await supabase(`/users_pro?email=eq.${encodeURIComponent(email)}&select=*`, 'GET');
    if (Array.isArray(rows) && rows.length > 0) {
      await supabase(`/users_pro?email=eq.${encodeURIComponent(email)}`, 'PATCH', {
        free_messages: (rows[0].free_messages || 0) + amount
      });
    } else {
      await supabase('/users_pro', 'POST', { id: 'user-' + Date.now(), email, free_messages: amount, is_premium: false, is_admin: false });
    }
    return res.status(200).json({ success: true });
  }

  if (action === 'setMaintenance') {
    const rows = await supabase('/app_settings?id=eq.1&select=id', 'GET');
    if (Array.isArray(rows) && rows.length > 0) {
      await supabase('/app_settings?id=eq.1', 'PATCH', { maintenance_mode: value });
    } else {
      await supabase('/app_settings', 'POST', { id: 1, maintenance_mode: value });
    }
    return res.status(200).json({ success: true });
  }

  if (action === 'getMaintenance') {
    const rows = await supabase('/app_settings?id=eq.1&select=maintenance_mode', 'GET');
    const maintenance = Array.isArray(rows) && rows.length > 0 ? rows[0].maintenance_mode : false;
    return res.status(200).json({ success: true, maintenance });
  }

  return res.status(400).json({ error: 'Action invalide' });
};
