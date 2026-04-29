module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const message = (req.body && req.body.message) || 'Bonjour';
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: message }]
      })
    });
    const data = await r.json();
    res.status(200).json({ reply: (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'ok' });
  } catch (e) {
    res.status(200).json({ reply: 'Erreur: ' + e.message });
  }
};
