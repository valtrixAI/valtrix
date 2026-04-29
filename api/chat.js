import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string'? JSON.parse(req.body) : req.body;
    const { messages = [], userId } = body || {};

    if (!messages.length) {
      return res.status(400).json({ error: 'Aucun message reçu' });
    }

    // 1. Sauvegarde le message utilisateur
    await supabase.from('messages').insert({
      user_id: userId,
      role: 'user',
      content: messages[messages.length - 1].content
    });

    // 2. Récupère l'historique
    const { data: historyData } = await supabase
     .from('messages')
     .select('role, content')
     .eq('user_id', userId)
     .order('created_at', { ascending: true })
     .limit(20);

    const history = (historyData || []).map(m => ({ role: m.role, content: m.content }));

    // 3. Appel Groq
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'Tu es Valtrix, un assistant IA francophone, clair et utile.' },
         ...history
        ],
        temperature: 0.7
      })
    });

    const groqData = await groqRes.json();
    const reply = groqData.choices?.[0]?.message?.content || "Désolé, je n'ai pas de réponse.";

    // 4. Sauvegarde la réponse
    await supabase.from('messages').insert({
      user_id: userId,
      role: 'assistant',
      content: reply
    });

    res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
