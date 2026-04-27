const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

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
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };

  const { action, user_id, chat_id, title, messages } = JSON.parse(event.body || '{}');

  // Sauvegarder un chat
  if (action === 'save') {
    const existing = await supabase(`/chats?id=eq.${chat_id}&select=id`, 'GET');
    if (existing.length > 0) {
      await supabase(`/chats?id=eq.${chat_id}`, 'PATCH', { title, messages, updated_at: new Date().toISOString() });
    } else {
      await supabase('/chats', 'POST', { id: chat_id, user_id, title, messages });
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // Charger les chats d'un utilisateur
  if (action === 'load') {
    const chats = await supabase(`/chats?user_id=eq.${user_id}&select=*&order=created_at.desc&limit=20`, 'GET');
    return { statusCode: 200, headers, body: JSON.stringify({ chats }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action invalide' }) };
};
