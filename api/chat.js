const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages = [], userId } = body || {};
    const userMessage = messages[messages.length - 1]?.content || '';
    if (userMessage && userId) {
      await supabase.from('messages').insert({ user_id: userId, role: 'user', content: userMessage });
    }
    const { data: historyData } = await supabase.from('messages').select('role,content').eq('user_id', userId).order('created_at', { ascending: true }).limit(20);
    const history = Array.isArray(historyData) ? historyData : [];
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'Tu es Valtrix, assistant francophone utile et concis.' },
          ...history,
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const reponseValtrix = data?.choices?.[0]?.message?.content || "Désolé, je n'ai pas de réponse.";
    await supabase.from('messages').insert({ user_id: userId, role: 'assistant', content: reponseValtrix });

    // Sauvegarde conversation
    const chatId = body.chat_id || userId + '_' + Date.now();
    const title = (userMessage || 'Chat').substring(0, 40);
    const { data: existing } = await supabase.from('chats').select('id').eq('id', chatId).maybeSingle();
    if (existing) {
      await supabase.from('chats').update({
        messages: history.concat({role:'user', content: userMessage}, {role:'assistant', content: reponseValtrix}),
        updated_at: new Date().toISOString()
      }).eq('id', chatId);
    } else {
      await supabase.from('chats').insert({
        id: chatId,
        user_id: userId,
        title,
        messages: history.concat({role:'user', content: userMessage}, {role:'assistant', content: reponseValtrix})
      });
    }
    res.status(200).json({ reply: reponseValtrix, chat_id: chatId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
