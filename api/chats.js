const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, user_id, chat_id, title, messages } = body || {};

    if (action === 'save') {

  if (!user_id || !chat_id) {
    return res.status(400).json({
      error: 'user_id et chat_id requis'
    });
  }

  // Vérifie si le chat existe
  const { data: existing, error: findError } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chat_id)
    .maybeSingle();

  if (findError) {
    console.error(findError);
    return res.status(500).json({
      error: findError.message
    });
  }

  // UPDATE
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
      console.error(updateError);
      return res.status(500).json({
        error: updateError.message
      });
    }

  } else {

    // INSERT
    const { error: insertError } = await supabase
      .from('chats')
      .insert({
        id: chat_id,
        user_id,
        title: title || 'Chat',
        messages: messages || []
      });

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({
        error: insertError.message
      });
    }
  }

  return res.status(200).json({
    success: true
  });
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
