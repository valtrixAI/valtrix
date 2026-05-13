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

    const body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body;

    const {
      action,
      user_id,
      chat_id,
      title,
      messages
    } = body;

    console.log("API CHATS BODY =", body); // 👈 DEBUG IMPORTANT

    // ───── SAVE ─────
    if (action === 'save') {

      if (!user_id || !chat_id) {
        return res.status(400).json({
          error: 'missing user_id or chat_id'
        });
      }

      const { data: existing, error: findError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chat_id)
        .maybeSingle();

      if (findError) {
        console.log("FIND ERROR:", findError);
        return res.status(500).json({ error: findError.message });
      }

      if (existing) {

        const { error: updateError } = await supabase
          .from('chats')
          .update({
            title: title || 'Chat',
            messages: messages || [],
            updated_at: new Date().toISOString()
          })
          .eq('id', chat_id);

        if (updateError) {
          console.log("UPDATE ERROR:", updateError);
          return res.status(500).json({ error: updateError.message });
        }

      } else {

        const { error: insertError } = await supabase
          .from('chats')
          .insert({
            id: chat_id,
            user_id,
            title: title || 'Chat',
            messages: messages || [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (insertError) {
          console.log("INSERT ERROR:", insertError);
          return res.status(500).json({ error: insertError.message });
        }
      }

      return res.status(200).json({ success: true });
    }

    // ───── LOAD ─────
    if (action === 'load') {

      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('user_id', user_id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.log("LOAD ERROR:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ chats: data || [] });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (e) {
    console.log("FATAL ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
};
