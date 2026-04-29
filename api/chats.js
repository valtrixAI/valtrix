const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function supabase(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      // FIX : PATCH → return=minimal, POST → return=representation
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (method === 'PATCH' || method === 'DELETE') return null;
  return res.json();
}

// FIX : supprime les données base64 des images avant sauvegarde (évite des payloads de plusieurs Mo)
function stripImages(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m;
    const content = m.content.map(block => {
      if (block.type === 'image') return { type: 'text', text: '[image envoyée]' };
      return block;
    });
    return { ...m, content };
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, user_id, chat_id, title, messages } = req.body || {};

  // ── SAUVEGARDER ──
  if (action === 'save') {
    if (!user_id || !chat_id) return res.status(400).json({ error: 'user_id et chat_id requis' });

    const cleanMessages = stripImages(messages || []);
    const existing = await supabase(`/chats?id=eq.${chat_id}&select=id`, 'GET');

    if (Array.isArray(existing) && existing.length > 0) {
      await supabase(`/chats?id=eq.${chat_id}`, 'PATCH', {
        title,
        messages: cleanMessages,
        updated_at: new Date().toISOString()
      });
    } else {
      await supabase('/chats', 'POST', {
        id: chat_id,
        user_id,
        title,
        messages: cleanMessages
      });
    }
    return res.status(200).json({ success: true });
  }

  // ── CHARGER ──
  if (action === 'load') {
    if (!user_id) return res.status(400).json({ error: 'user_id requis' });
    const chats = await supabase(
      `/chats?user_id=eq.${user_id}&select=id,title,created_at,messages&order=created_at.desc&limit=20`,
      'GET'
    );
    return res.status(200).json({ chats: Array.isArray(chats) ? chats : [] });
  }

  // ── SUPPRIMER ──
  if (action === 'delete') {
    if (!chat_id) return res.status(400).json({ error: 'chat_id requis' });
    await supabase(`/chats?id=eq.${chat_id}`, 'DELETE');
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Action invalide' });
};
