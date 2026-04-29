import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GROQ_KEY = process.env.GROQ_API_KEY; // à ajouter dans Vercel
const LIMIT_FREE = 20;

export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).end();

  const { userId, conversationId, message } = req.body;

  // 1. Récupère l'utilisateur
  const { data: user } = await supabase.from('users').select('premium').eq('id', userId).single();

  // 2. Compte ses messages
  const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'user');

  if (!user?.premium && count >= LIMIT_FREE) {
    return res.json({ error: 'limit' });
  }

  // 3. Choisis le modèle selon Premium
  const model = user?.premium
   ? 'llama-3.3-70b-versatile' // Premium = cerveau
    : 'llama-3.1-8b-instant'; // Gratuit = rapide

  // 4. Appel Groq
  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: message }],
      temperature: 0.7
    })
  });

  const data = await groqRes.json();
  const reply = data.choices?.[0]?.message?.content || 'Erreur IA';

  // 5. Sauvegarde
  await supabase.from('messages').insert([
    { user_id: userId, conversation_id: conversationId, role: 'user', content: message },
    { user_id: userId, conversation_id: conversationId, role: 'assistant', content: reply }
  ]);

  res.json({ reply, model });
}
