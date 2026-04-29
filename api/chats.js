const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

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
  if (!res.ok) throw new Error(await res.text());
  if (method === 'PATCH' || method === 'DELETE') return null;
  return res.json();
}

function stripImages(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m;
    const content = m.content.map(b => b.type === 'image' ? { type:'text', text:'[image]' } : b);
    return { ...m, content };
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, user_id, chat_id, title, messages } = req.body || {};
    if (action === 'save') {
      const clean = stripImages(messages || []);
      const ex = await supabase(`/chats?id=eq.${chat_id}&select=id`, 'GET');
      if (ex.length) await supabase(`/chats?id=eq.${chat_id}`, 'PATCH', { title, messages: clean, updated_at: new Date().toISOString() });
      else await supabase('/chats', 'POST', { id: chat_id, user_id, title, messages: clean });
      return res.json({ success: true });
    }
    if (action === 'load') {
      const chats = await supabase(`/chats?user_id=eq.${user_id}&select=id,title,created_at,messages&order=created_at.desc&limit=20`, 'GET');
      return res.json({ chats });
    }
    if (action === 'delete') {
      await supabase(`/chats?id=eq.${chat_id}`, 'DELETE');
      return res.json({ success: true });
    }
    return res.status(400).json({ error: 'Action invalide' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
