const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { message, userId } = req.body || {};

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: message || 'Bonjour' }]
      })
    });
    const data = await r.json();
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'ok';

    if (userId) {
      await supabase.from('messages').insert([
        { user_id: userId, role: 'user', content: message },
        { user_id: userId, role: 'assistant', content: reply }
      ]);
    }

    res.status(200).json({ reply });
  } catch (e) {
    res.status(200).json({ reply: 'Erreur: ' + e.message });
  }
};
