import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GROQ_KEY = process.env.GROQ_API_KEY;
const LIMIT_FREE = 20;

export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).end();

  try {
    const { userId, conversationId, message } = req.body;

    if (!GROQ_KEY) throw new Error('GROQ_API_KEY manquante dans Vercel');

    // 1. Utilisateur
    const { data: user } = await supabase.from('users').select('premium').eq('id', userId).single();

    // 2. Compte messages
    const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'user');

    if (!user?.premium && count >= LIMIT_FREE) {
      return res.json({ error: 'limit' });
    }

    // 3. Modèle
    const model = user?.premium? 'llama-3.3-70b-versatile' : 'llama-3.1-8b-instant';

    // 4. Groq
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: message }], temperature: 0.7 })
    });

    const data = await groqRes.json();
    if (!data.choices) throw new Error('Groq error: ' + JSON.stringify(data));

    const reply = data.choices[0].message.content;

    // 5. Sauvegarde
    await supabase.from('messages').insert([
      { user_id: userId, conversation_id: conversationId, role: 'user', content: message },
      { user_id: userId, conversation_id: conversationId, role: 'assistant', content: reply }
    ]);

    res.json({ reply, model });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
