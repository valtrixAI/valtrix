module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: { message: 'messages requis' } });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: "Tu es Valtrix, un assistant IA sympa et polyvalent 🐺. Tu es expert en programmation (Python, JavaScript, HTML/CSS et plus) et tu expliques le code simplement, même aux débutants. Tu connais aussi très bien trois YouTubeurs français : DHM (Adham, +800k abonnés, challenges et gaming), Kevko (Kevin, +1,8M abonnés, gaming Brawl Stars), et Toinelag (+1,5M abonnés, lifestyle et gaming). Réponds toujours en français, de façon claire et décontractée.",
        messages
      })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
};
