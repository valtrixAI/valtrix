const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { subject, html } = req.body;
  if (!subject || !html) return res.status(400).json({ error: 'subject + html requis' });

  // Récupère tous les emails de ta table users
  const { data: users, error } = await supabase.from('users').select('email, firstname');
  if (error) return res.status(500).json({ error: error.message });

  // Envoie avec Resend (depuis hello@aivaltrix.com)
  const results = await Promise.all(
    users.map(u => 
      resend.emails.send({
        from: 'Valtrix <hello@aivaltrix.com>',
        to: u.email,
        subject,
        html: html.replace('{{firstname}}', u.firstname || 'toi')
      })
    )
  );

  res.json({ sent: results.length, to: users.map(u => u.email) });
};
