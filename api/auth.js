export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string'? JSON.parse(req.body) : req.body;
    const { email, provider } = body || {};

    const id = provider? `${provider}_${Date.now()}` : `email_${Date.now()}`;
    const userEmail = email || `${provider || 'demo'}@valtrix.app`;

    return res.status(200).json({ success: true, user: { id, email: userEmail } });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}