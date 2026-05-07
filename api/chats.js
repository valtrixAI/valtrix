import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, user_id, chat_id, title, messages } = body || {};

    // ── SAUVEGARDER ──
    if (action === 'save') {
      if (!user_id || !chat_id) return res.status(400).json({ error: 'user_id et chat_id requis' });

      const { data: existing } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chat_id)
        .maybeSingle();

      if (existing) {
        await supabase.from('chats').update({
          title,
          messages,
          updated_at: new Date().toISOString()
        }).eq('id', chat_id);
      } else {
        await supabase.from('chats').insert({
          id: chat_id,
          user_id,
          title,
          messages
        });
      }
      return res.status(200).json({ success: true });
    }

    // ── CHARGER ──
    if (action === 'load') {
      if (!user_id) return res.status(400).json({ error: 'user_id requis' });

      const { data: chats } = await supabase
        .from('chats')
        .select('id,title,created_at,messages')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(20);

      return res.status(200).json({ chats: chats || [] });
    }

    // ── SUPPRIMER ──
    if (action === 'delete') {
      if (!chat_id) return res.status(400).json({ error: 'chat_id requis' });
      await supabase.from('chats').delete().eq('id', chat_id);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Action invalide' });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
