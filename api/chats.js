const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, user_id, chat_id, title, messages } = body;

    console.log("API CHATS BODY =", { action, user_id, chat_id });

    // ───── SAVE ─────
    if (action === 'save') {
      if (!user_id || !chat_id) {
        return res.status(400).json({ error: 'missing user_id or chat_id' });
      }

      const { error } = await supabase
        .from('chats')
        .upsert({
          id: chat_id,
          user_id,
          title: title || 'Chat',
          messages: messages || [],
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // ───── LOAD ─────
    if (action === 'load') {
      if (!user_id) return res.status(400).json({ error: 'missing user_id' });
      
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', user_id)
        .order('updated_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ chats: data || [] });
    }

    // ───── DELETE ─────
    if (action === 'delete') {
      if (!user_id || !chat_id) {
        return res.status(400).json({ error: 'missing user_id or chat_id' });
      }

      const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', chat_id)
        .eq('user_id', user_id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // ───── RENAME ─────
    if (action === 'rename') {
      if (!user_id || !chat_id || !title) {
        return res.status(400).json({ error: 'missing user_id, chat_id or title' });
      }

      const { error } = await supabase
        .from('chats')
        .update({ 
          title,
          updated_at: new Date().toISOString()
        })
        .eq('id', chat_id)
        .eq('user_id', user_id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (e) {
    console.log("FATAL ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
};
