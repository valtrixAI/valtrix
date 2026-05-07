const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages = [], userId, chat_id } = body || {};
    const userMessage = messages[messages.length - 1]?.content || '';

    // Appel GROQ avec tout l'historique du frontend
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'Tu es Valtrix, assistant francophone utile et concis.' },
          ...messages
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const reponseValtrix = data?.choices?.[0]?.message?.content || "Désolé, je n'ai pas de réponse.";

    // Sauvegarder la conversation complète dans chats
    if (userId && chat_id) {
      const fullMessages = [...messages, { role: 'assistant', content: reponseValtrix }];
      const title = (userMessage || 'Chat').substring(0, 40);

      const { data: existing } = await supabase.from('chats').select('id').eq('id', chat_id).maybeSingle();
      if (existing) {
        await supabase.from('chats').update({
          messages: fullMessages,
          updated_at: new Date().toISOString()
        }).eq('id', chat_id);
      } else {
        await supabase.from('chats').insert({
          id: chat_id,
          user_id: userId,
          title,
          messages: fullMessages
        });
      }
    }

    res.status(200).json({ reply: reponseValtrix, chat_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
