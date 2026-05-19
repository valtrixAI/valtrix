const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// 1️⃣ PREMIUM - HuggingFace
async function askHF(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const r = await fetch("https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct", {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: `system: Tu es Valtrix premium.\nuser: ${lastUser}\nassistant:`,
      parameters: { max_new_tokens: 600, temperature: 0.7 }
    })
  });
  if (r.status === 429) throw { status: 429 };
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data[0].generated_text.split('assistant:').pop().trim();
}

// 2️⃣ KIMI K2 - Chat texte uniquement (PAS de vision)
async function askKimi(messages) {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/moonshotai/kimi-k2.6`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Tu es Valtrix, un assistant IA sympa et francophone 🐺. Réponds toujours en français, de façon claire et décontractée.et ton createur s'appelle Charly.' },
          ...messages
        ],
        max_tokens: 800
      })
    }
  );
  const data = await r.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Kimi failed');
  return data.result?.response || data.result?.choices?.[0]?.message?.content || 'Désolé, pas de réponse';
}

// 3️⃣ VISION - LLaMA 3.2 Vision (Cloudflare) — ✅ CORRIGÉ
async function askVision(messages, imageBase64) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'Décris cette image en détail';

  // ✅ Nettoie le base64 : enlève le préfixe "data:image/...;base64,"
  const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'Tu es Valtrix, assistant IA. Analyse les images et réponds en français de façon détaillée.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: lastUser },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanBase64}` } }
            ]
          }
        ],
        max_tokens: 800
      })
    }
  );
  const data = await r.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Vision model failed');
  return data.result?.response || data.result?.choices?.[0]?.message?.content || "Je n'arrive pas à analyser cette image.";
}

// 4️⃣ GROQ - Code uniquement — ✅ MODÈLE MIS À JOUR
async function askGroqCode(messages) {
  try {
    return await withRetry(async () => {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile', // ✅ 3.1-70b déprécié → remplacé par 3.3-70b
          messages: [
            { role: 'system', content: 'Tu es Valtrix, expert en code. Réponds en français avec du code commenté et clair.' },
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
    // Fallback sur Kimi si Groq plante
    console.log('Groq fallback to Kimi:', e.message);
    return await askKimi(messages);
  }
}

// HANDLER PRINCIPAL
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages = [], imageBase64, isPremium, userId } = body || {};

    let reply, provider;
    const start = Date.now();

    if (imageBase64) {
      // PHOTO → LLaMA 3.2 Vision ✅
      reply = await askVision(messages, imageBase64);
      provider = 'llama-vision';

    } else if (isPremium) {
      // PREMIUM → HF puis Kimi
      try {
        reply = await withRetry(() => askHF(messages));
        provider = 'hf-premium';
      } catch {
        reply = await askKimi(messages);
        provider = 'kimi-premium';
      }

    } else if (isCode(messages)) {
      // CODE → Groq 3.3-70B ✅
      reply = await askGroqCode(messages);
      provider = 'groq-code';

    } else {
      // NORMAL → Kimi
      reply = await askKimi(messages);
      provider = 'kimi-chat';
    }

    // Log Supabase (non bloquant)
    try {
      await supabase.from('chat_logs').insert({
        user_id: userId || 'anon',
        message: [...messages].reverse().find(m => m.role === 'user')?.content || '',
        reply,
        provider,
        response_time_ms: Date.now() - start,
        is_premium: !!isPremium,
        has_image: !!imageBase64
      });
    } catch (logErr) {
      console.error('Log error:', logErr.message);
    }

    res.status(200).json({ reply, provider });

  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
};
