const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const resend = new Resend(process.env.RESEND_KEY); // ← corrigé ici
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { subject, html } = req.body;
  if (!subject || !html) return res.status(400).json({ error: 'subject + html requis' });

  // Récupère tous les emails
  const { data: users, error } = await supabase.from('users').select('email, firstname');
  if (error) return res.status(500).json({ error: error.message });
  if (!users || users.length === 0) return res.status(200).json({ sent: 0, message: 'Aucun utilisateur' });

  // Envoie
  const results = await Promise.allSettled(
    users.map(u => 
      resend.emails.send({
        from: 'Valtrix <hello@aivaltrix.com>',
        to: u.email,
        subject,
        html: html.replace('{{firstname}}', u.firstname || 'toi')
      })
    )
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  res.json({ sent, to: users.map(u => u.email), errors: results.filter(r => r.status === 'rejected').map(r => r.reason?.message) });
};
