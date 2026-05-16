const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Détecte si c'est du code
const isCode = (msgs) => {
  const lastUser = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
  return /code|bug|debug|javascript|python|html|css|react|api|fonction|script/i.test(lastUser);
};

// Retry si rate limit
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

// 1. Hugging Face (premium)
async function askHF(messages) {
  if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN manquant');
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const r = await fetch("https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct", {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\nTu es Valtrix, assistant francophone premium.<|eot_id|><|start_header_id|>user<|end_header_id|>\n${lastUser}<|eot_id|><|start_header_id|>assistant<|end_header_id|>`,
      parameters: { max_new_tokens: 500, temperature: 0.7 }
    })
  });
  if (r.status === 429) throw { status: 429 };
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data[0].generated_text.split('<|start_header_id|>assistant<|end_header_id|>').pop().trim();
}

// 2. Groq pour le code
async function askGroqCode(messages) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages: [{ role: 'system', content: 'Tu es Valtrix, expert code. Réponds en français.' },...messages],
      temperature: 0.3
    })
  });
  if (r.status === 429) throw { status: 429 };
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

// 3. Cloudflare (chat normal)
async function askCloudflare(messages) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.CF_TOKEN}` },
    body: JSON.stringify({
      messages: [{ role: 'system', content: 'Tu es Valtrix, assistant francophone utile.' },...messages]
    })
  });
  const data = await r.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Cloudflare error');
  return data.result.response;
}

// 4. Gemini pour les images (CORRIGÉ)
async function askGemini(messages, imageBase64) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'Décris cette image';

  // ✅ Nettoie le base64
  const cleanBase64 = imageBase64.includes(',')? imageBase64.split(',')[1] : imageBase64;

  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY manquante');

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: lastUser },
        { inline_data: { mime_type: "image/jpeg", data: cleanBase64 } }
      ]}]
    })
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

module.exports = async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string'? JSON.parse(req.body) : req.body;
    const { messages = [], imageBase64, isPremium, userId } = body || {};
    let reply, provider;
    const startTime = Date.now();

    // Règle 1: Image = Gemini
    if (imageBase64) {
      reply = await askGemini(messages, imageBase64);
      provider = 'gemini-vision';
    }
    // Règle 2: Premium
    else if (isPremium) {
      try {
        reply = await withRetry(() => askHF(messages));
        provider = 'hf-premium';
      } catch {
        if (isCode(messages)) {
          reply = await withRetry(() => askGroqCode(messages));
          provider = 'groq-fallback';
        } else {
          reply = await askCloudflare(messages);
          provider = 'cloudflare-fallback';
        }
      }
    }
    // Règle 3: Code
    else if (isCode(messages)) {
      reply = await withRetry(() => askGroqCode(messages));
      provider = 'groq-code';
    }
    // Règle 4: Chat normal
    else {
      reply = await askCloudflare(messages);
      provider = 'cloudflare-chat';
    }

    // Log dans Supabase (sans crasher)
    try {
      const responseTime = Date.now() - startTime;
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
      await supabase.from('chat_logs').insert({
        user_id: userId || 'anonymous',
        message: lastUserMsg,
        reply: reply,
        provider: provider,
        response_time_ms: responseTime,
        is_premium: isPremium || false,
        has_image:!!imageBase64
      });
    } catch (logErr) {
      console.log('Log skip:', logErr.message);
    }

    res.status(200).json({ reply, provider });

  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
};
