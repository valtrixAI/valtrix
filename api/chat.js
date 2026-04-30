import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string'? JSON.parse(req.body) : req.body;
    const { messages = [], userId } = body || {};

    if (!messages.length) return res.status(400).json({ error: 'Pas de message' });

    const userMsg = messages[messages.length - 1].content;

    await supabase.from('messages').insert({ user_id: userId, role: 'user', content: userMsg });

    const { data } = await supabase.from('messages').select('role,content').eq('user_id', userId).order('created_at', { ascending: true }).limit(20);
    const history = (data || []).map(m => ({ role: m.role, content: m.content }));

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: 'Tu es Valtrix, assistant francophone utile et concis.' },...history],
        temperature: 0.7
      })
    });

    const j = await r.json();
    const reply = j.choices?.[0]?.message?.content || "Désolé, je n'ai pas de réponse.";

    await supabase.from('messages').insert({ user_id: userId, role: 'assistant', content: reply });

    res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
