// /api/chats.js - sauvegarde historique Valtrix
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { action, user_id, chat_id, title, messages } = req.body;

  try {
    if (action === 'save') {
      // Sauvegarde ou met à jour un chat
      const { data, error } = await supabase
        .from('chats')
        .upsert({
          id: chat_id,
          user_id,
          title: title || 'Nouvelle conversation',
          messages,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (error) throw error;
      return res.json({ success: true });
    }

    if (action === 'load') {
      // Charge tous les chats d'un user
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', user_id)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return res.json({ chats: data || [] });
    }

    if (action === 'delete') {
      const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', chat_id)
        .eq('user_id', user_id);

      if (error) throw error;
      return res.json({ success: true });
    }

    if (action === 'rename') {
      const { error } = await supabase
        .from('chats')
        .update({ title })
        .eq('id', chat_id)
        .eq('user_id', user_id);

      if (error) throw error;
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error('Chats error:', e);
    res.status(500).json({ error: e.message });
  }
}
