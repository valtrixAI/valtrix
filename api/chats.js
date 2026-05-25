// /api/chats.js - Valtrix historique (version qui enregistre)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, user_id, chat_id, title, messages } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id manquant' });
  }

  try {
    // === SAVE ===
    if (action === 'save') {
      const chatData = {
        id: chat_id,
        user_id: user_id,
        title: (title || 'Chat').substring(0, 100),
        messages: messages || [],
        updated_at: new Date().toISOString()
      };

      // D'abord on vérifie si le chat existe
      const { data: existing } = await supabase
        .from('chats')
        .select('id')
        .eq('id', chat_id)
        .single();

      if (!existing) {
        chatData.created_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('chats')
        .upsert(chatData, { 
          onConflict: 'id',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('Supabase save error:', error);
        throw new Error(error.message);
      }

      return res.status(200).json({ success: true, chat_id });
    }

    // === LOAD ===
    if (action === 'load') {
      const { data, error } = await supabase
        .from('chats')
        .select('id, title, messages, created_at, updated_at, user_id')
        .eq('user_id', user_id)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      return res.status(200).json({ 
        chats: data || [],
        success: true 
      });
    }

    // === DELETE ===
    if (action === 'delete') {
      const { error } = await supabase
        .from('chats')
        .delete()
        .match({ id: chat_id, user_id: user_id });

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    // === RENAME ===
    if (action === 'rename') {
      const { error } = await supabase
        .from('chats')
        .update({ 
          title: title.substring(0, 100),
          updated_at: new Date().toISOString()
        })
        .match({ id: chat_id, user_id: user_id });

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Action invalide' });

  } catch (err) {
    console.error('API chats error:', err);
    return res.status(500).json({ 
      error: err.message || 'Erreur serveur',
      details: err 
    });
  }
}
