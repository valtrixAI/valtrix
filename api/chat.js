const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = 'Tu es Valtrix, un assistant IA sympa et francophone 🐺. Réponds toujours en français, de façon claire et décontractée. Tu te souviens de tout ce qui a été dit dans la conversation.';

// Détecte si c'est du code
const isCode = (msgs) => {
  const last = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
  return /code|bug|debug|javascript|python|html|css|react|api|fonction|script|erreur/i.test(last);
};

async function withRetry(fn) {
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) {
      if (e.status === 429 && i < 2) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

// ─── CLOUDFLARE TEXTE (avec fallback) ───────────────────────────────────────
// Essaie Kimi K2 d'abord, si ça marche pas → LLaMA 3.1 8B (toujours dispo)
async function askCF(messages) {
  // Tentative 1 : Kimi K2
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/moonshotai/kimi-k2.6`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.CF_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // ✅ Historique COMPLET envoyé → contexte conservé
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
          max_tokens: 800
        })
      }
    );
    const data = await r.json();
    if (data.success) {
      const reply = data.result?.response || data.result?.choices?.[0]?.message?.content;
      if (reply) return { reply, model: 'kimi-k2' };
    }
  } catch (e) {
    console.log('Kimi K2 failed, fallback to LLaMA:', e.message);
  }

  // Fallback : LLaMA 3.1 8B (toujours disponible sur Cloudflare)
  const r2 = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // ✅ Historique COMPLET envoyé → contexte conservé
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 800
      })
    }
  );
  const data2 = await r2.json();
  if (!data2.success) throw new Error(data2.errors?.[0]?.message || 'Cloudflare failed');
  return { reply: data2.result?.response || 'Désolé, pas de réponse', model: 'llama-3.1-8b' };
}

// ─── GROQ CODE ───────────────────────────────────────────────────────────────
async function askGroqCode(messages) {
  try {
    return await withRetry(async () => {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile', // ✅ 3.1 déprécié → 3.3
          // ✅ Historique COMPLET envoyé → contexte conservé
          messages: [
            { role: 'system', content: 'Tu es Valtrix, expert en code. Réponds en français avec du code commenté et clair. Utilise des blocs ```langage pour le code.' },
            ...messages
          ],
          temperature: 0.2,
          max_tokens: 1500
        })
      });
      if (r.status === 429) throw { status: 429 };
      const data = await r.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.choices[0].message.content;
    });
  } catch (e) {
    console.log('Groq failed, fallback to CF:', e.message);
    const { reply } = await askCF(messages);
    return reply;
  }
}

// ─── VISION ──────────────────────────────────────────────────────────────────
async function askVision(messages, imageBase64) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'Décris cette image en détail';
  // ✅ Nettoie le base64
  const cleanB64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Tu es Valtrix. Analyse les images et réponds en français de façon détaillée.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: lastUser },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanB64}` } }
            ]
          }
        ],
        max_tokens: 800
      })
    }
  );
  const data = await r.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Vision failed');
  return data.result?.response || data.result?.choices?.[0]?.message?.content || "Je n'arrive pas à analyser cette image.";
}

// ─── HUGGING FACE PREMIUM ─────────────────────────────────────────────────────
async function askHF(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const r = await fetch("https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct", {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: `system: ${SYSTEM_PROMPT}\nuser: ${lastUser}\nassistant:`,
      parameters: { max_new_tokens: 600, temperature: 0.7 }
    })
  });
  if (r.status === 429) throw { status: 429 };
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data[0].generated_text.split('assistant:').pop().trim();
}

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages = [], imageBase64, isPremium, userId } = body || {};

    let reply, provider;
    const start = Date.now();

    if (imageBase64) {
      // PHOTO → LLaMA Vision
      reply = await askVision(messages, imageBase64);
      provider = 'llama-vision';

    } else if (isPremium) {
      // PREMIUM → HF puis Cloudflare
      try {
        reply = await withRetry(() => askHF(messages));
        provider = 'hf-premium';
      } catch {
        const { reply: r, model } = await askCF(messages);
        reply = r; provider = model + '-premium';
      }

    } else if (isCode(messages)) {
      // CODE → Groq 3.3-70B
      reply = await askGroqCode(messages);
      provider = 'groq-code';

    } else {
      // CHAT NORMAL → Cloudflare (Kimi ou LLaMA fallback)
      const { reply: r, model } = await askCF(messages);
      reply = r; provider = model + '-chat';
    }

    // Log Supabase (non bloquant)
    try {
      await supabase.from('chat_logs').insert({
        user_id: userId || 'anon',
        message: [...messages].reverse().find(m => m.role === 'user')?.content || '',
        reply, provider,
        response_time_ms: Date.now() - start,
        is_premium: !!isPremium,
        has_image: !!imageBase64
      });
    } catch (e) { console.log('Log skip:', e.message); }

    res.status(200).json({ reply, provider });

  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
};
