module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { messages } = req.body;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:1024, system:"Tu es Valtrix, assistant sympa 🐺", messages })
    });
    const data = await r.json();
    return res.json(data);
  } catch(e){ return res.status(500).json({ error: e.message }); }
};
