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

// Retry 3x
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

// 1️⃣ PREMIUM : HuggingFace
async function askHF(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const r = await fetch("https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct", {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: `system: Tu es Valtrix, assistant premium francophone.\nuser: ${lastUser}\nassistant:`,
      parameters: { max_new_tokens: 600, temperature: 0.7 }
    })
  });
  if (r.status === 429) throw { status: 429 };
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data[0].generated_text.split('assistant:').pop().trim();
}

// 2️⃣ CODE : Groq → fallback Cloudflare
async function askGroqCode(messages) {
  try {
    return await withRetry(async () => {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-70b-versatile',
          messages: [{ role: 'system', content: 'Tu es Valtrix, expert code. Réponds en français, clair et direct.' },...messages],
          temperature: 0.2,
          max_tokens: 800
        })
      });
      if (r.status === 429) throw { status: 429 };
      const data = await r.json();
      return data.choices[0].message.content;
    });
  } catch {
    // Fallback Cloudflare si Groq saturé
    return await askCloudflareBase(messages, 'Tu es Valtrix expert code.');
  }
}

// 3️⃣ CHAT NORMAL : Cloudflare → fallback Groq
async function askCloudflare(messages) {
  try {
    return await askCloudflareBase(messages, 'Tu es Valtrix, assistant utile et sympa.');
  } catch {
    // Fallback Groq si Cloudflare saturé
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'system', content: 'Tu es Valtrix.' },...messages],
        temperature: 0.7
      })
    });
    const data = await r.json();
    return data.choices[0].message.content;
  }
}

async function askCloudflareBase(messages, systemPrompt) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [{ role: 'system', content: systemPrompt },...messages]
    })
  });
  const data = await r.json();
  if (!data.success) throw new Error('cf-fail');
  return data.result.response;
}

// 4️⃣ VISION : Cloudflare Llava (photos)
async function askVision(messages, imageBase64) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'Décris cette image précisément';
  const cleanBase64 = imageBase64.includes(',')? imageBase64.split(',')[1] : imageBase64;

  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/llava-hf/llava-1.5-7b-hf`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      image: cleanBase64,
      prompt: lastUser,
      max_tokens: 512
    })
  });
  const data = await r.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Vision failed');
  return data.result.description;
}

// HANDLER PRINCIPAL
module.exports = async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string'? JSON.parse(req.body) : req.body;
    const { messages = [], imageBase64, isPremium, userId } = body || {};
    let reply, provider;
    const start = Date.now();

    // ROUTING INTELLIGENT
    if (imageBase64) {
      // PHOTO → Vision Cloudflare
      reply = await askVision(messages, imageBase64);
      provider = 'vision-cloudflare';
    } else if (isPremium) {
      // PREMIUM → HF → fallback intelligent
      try {
        reply = await withRetry(() => askHF(messages));
        provider = 'hf-premium';
      } catch {
        reply = isCode(messages)
         ? await askGroqCode(messages)
          : await askCloudflare(messages);
        provider = isCode(messages)? 'groq-fallback-premium' : 'cf-fallback-premium';
      }
    } else if (isCode(messages)) {
      // CODE → Groq → fallback Cloudflare
      reply = await askGroqCode(messages);
      provider = 'groq-code';
    } else {
      // BANAL → Cloudflare → fallback Groq
      reply = await askCloudflare(messages);
      provider = 'cloudflare-chat';
    }

    // Log Supabase
    try {
      await supabase.from('chat_logs').insert({
        user_id: userId || 'anon',
        message: [...messages].reverse().find(m => m.role === 'user')?.content || '',
        reply,
        provider,
        response_time_ms: Date.now() - start,
        is_premium:!!isPremium,
        has_image:!!imageBase64
      });
    } catch {}

    res.status(200).json({ reply, provider });

  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
};
