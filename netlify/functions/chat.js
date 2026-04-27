const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { messages } = JSON.parse(event.body);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
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
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: { message: err.message } }) };
  }
};
