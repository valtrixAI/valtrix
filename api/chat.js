const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYSTEM_PROMPT = 'Tu es Valtrix, un assistant IA sympa et francophone 🐺. Réponds toujours en français, de façon claire et décontractée. Tu te souviens de tout ce qui a été dit dans la conversation.';
const SYSTEM_CODE   = 'Tu es Valtrix, expert en code. Réponds en français avec du code commenté et clair. Utilise des blocs ```langage pour le code.';

// ─── ROTATION 3 TOKENS HF ─────────────────────────────────────────────────────
const HF_TOKENS = [
  process.env.HF_TOKEN_1,
  process.env.HF_TOKEN_2,
  process.env.HF_TOKEN_3
].filter(Boolean);
let hfIdx = 0;
function getHFToken() {
  if (!HF_TOKENS.length) return process.env.HF_TOKEN || '';
  const t = HF_TOKENS[hfIdx % HF_TOKENS.length];
  hfIdx++;
  return t;
}

// Détecte si c'est du code
const isCode = (msgs) => {
  const last = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
  return /code|bug|debug|javascript|python|html|css|react|api|fonction|script|erreur/i.test(last);
};

// ─── 1. HF TEXTE : Mistral-7B → Llama-3.1-8B ────────────────────────────────
async function askHFText(messages, codeQuery = false) {
  const system   = codeQuery ? SYSTEM_CODE : SYSTEM_PROMPT;
  const maxTok   = codeQuery ? 1500 : 800;
  const temp     = codeQuery ? 0.2 : 0.7;

  // Tentative 1 : Mistral-7B (très stable)
  try {
    const r = await fetch(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getHFToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'mistralai/Mistral-7B-Instruct-v0.3',
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: maxTok,
          temperature: temp
        })
      }
    );
    if (r.ok) {
      const data = await r.json();
      const reply = data.choices?.[0]?.message?.content;
      if (reply) return reply;
    }
    console.log('Mistral-7B failed, trying Llama-3.1-8B');
  } catch (e) {
    console.log('Mistral error:', e.message);
  }

  // Tentative 2 : Llama-3.1-8B (fallback HF)
  const r2 = await fetch(
    'https://api-inference.huggingface.co/models/meta-llama/Llama-3.1-8B-Instruct/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getHFToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/Llama-3.1-8B-Instruct',
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: maxTok,
        temperature: temp
      })
    }
  );
  if (!r2.ok) throw new Error(`HF HTTP ${r2.status}`);
  const data2 = await r2.json();
  const reply2 = data2.choices?.[0]?.message?.content;
  if (!reply2) throw new Error('HF no response');
  return reply2;
}

// ─── 2. HF VISION : BLIP → vit-gpt2 ─────────────────────────────────────────
async function askHFVision(messages, imageBase64) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'Décris cette image en détail';
  const cleanB64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  // Tentative 1 : BLIP large (très stable)
  try {
    const r = await fetch(
      'https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-large',
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getHFToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: cleanB64 })
      }
    );
    if (r.ok) {
      const data = await r.json();
      const caption = data[0]?.generated_text;
      if (caption) return `Voici ce que je vois sur cette image 🖼️ : ${caption}`;
    }
    console.log('BLIP failed, trying vit-gpt2');
  } catch (e) {
    console.log('BLIP error:', e.message);
  }

  // Tentative 2 : vit-gpt2 (ultra léger, toujours dispo)
  try {
    const r2 = await fetch(
      'https://api-inference.huggingface.co/models/nlpconnect/vit-gpt2-image-captioning',
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getHFToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: cleanB64 })
      }
    );
    if (r2.ok) {
      const data2 = await r2.json();
      const caption2 = data2[0]?.generated_text;
      if (caption2) return `Sur cette image je vois 🖼️ : ${caption2}`;
    }
  } catch (e) {
    console.log('vit-gpt2 error:', e.message);
  }

  return "Je n'arrive pas à analyser cette image pour le moment 🙏 Réessaie dans quelques secondes.";
}

// ─── 3. GROQ 70B (fallback texte si HF surchargé) ────────────────────────────
async function askGroq70B(messages, codeQuery = false) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: codeQuery ? SYSTEM_CODE : SYSTEM_PROMPT }, ...messages],
      temperature: codeQuery ? 0.2 : 0.7,
      max_tokens: codeQuery ? 1500 : 800
    })
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content;
}

// ─── 4. GROQ 8B INSTANT (fallback ultime, ultra rapide) ──────────────────────
async function askGroq8B(messages, codeQuery = false) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'system', content: codeQuery ? SYSTEM_CODE : SYSTEM_PROMPT }, ...messages],
      temperature: codeQuery ? 0.2 : 0.7,
      max_tokens: codeQuery ? 1500 : 800
    })
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content;
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages = [], imageBase64, isPremium, userId } = body || {};

    let reply, provider;
    const start     = Date.now();
    const codeQuery = isCode(messages);

    if (imageBase64) {
      // VISION : BLIP → vit-gpt2 (HF)
      reply    = await askHFVision(messages, imageBase64);
      provider = 'hf-vision';

    } else {
      // TEXTE :
      // 1. HF Mistral-7B
      // 2. HF Llama-3.1-8B
      // 3. Groq 70B
      // 4. Groq 8B-instant
      try {
        reply    = await askHFText(messages, codeQuery);
        provider = codeQuery ? 'hf-code' : 'hf-chat';
      } catch (e1) {
        console.log('HF failed, trying Groq 70B:', e1.message);
        try {
          reply    = await askGroq70B(messages, codeQuery);
          provider = codeQuery ? 'groq70-code' : 'groq70-chat';
        } catch (e2) {
          console.log('Groq 70B failed, trying Groq 8B:', e2.message);
          reply    = await askGroq8B(messages, codeQuery);
          provider = 'groq8b-instant';
        }
      }
    }

    // Log Supabase (non bloquant)
    try {
      await supabase.from('chat_logs').insert({
        user_id:          userId || 'anon',
        message:          [...messages].reverse().find(m => m.role === 'user')?.content || '',
        reply,
        provider,
        response_time_ms: Date.now() - start,
        is_premium:       !!isPremium,
        has_image:        !!imageBase64
      });
    } catch (e) { console.log('Log skip:', e.message); }

    res.status(200).json({ reply, provider });

  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
};
