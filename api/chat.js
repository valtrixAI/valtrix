const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// 1️⃣ PREMIUM HF
async function askHF(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const r = await fetch("https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct", {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
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

// 2️⃣ KIMI K2.6 (texte + vision) - ID CORRECT
async function askKimi(messages, imageBase64 = null) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'Bonjour';
  const content = [{ type: 'text', text: lastUser }];

  if (imageBase64) {
    content.push({ type: 'image_url', image_url: { url: imageBase64 } });
  }

  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/moonshotai/kimi-k2.6`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      max_tokens: 800
    })
  });

  const data = await r.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Kimi failed');
  return data.result.response;
}

// 3️⃣ GROQ code
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
          messages: [{ role: 'system', content: 'Tu es Valtrix expert code.' },...messages],
          temperature: 0.2
        })
      });
      if (r.status === 429) throw { status: 429 };
      const data = await r.json();
      return data.choices[0].message.content;
    });
  } catch {
    return await askKimi(messages);
  }
}

module.exports = async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string'? JSON.parse(req.body) : req.body;
    const { messages = [], imageBase64, isPremium, userId } = body || {};
    let reply, provider;
    const start = Date.now();

    if (imageBase64) {
      reply = await askKimi(messages, imageBase64);
      provider = 'kimi-vision';
    } else if (isPremium) {
      try {
        reply = await withRetry(() => askHF(messages));
        provider = 'hf-premium';
      } catch {
        reply = await askKimi(messages);
        provider = 'kimi-premium';
      }
    } else if (isCode(messages)) {
      reply = await askGroqCode(messages);
      provider = 'groq-code';
    } else {
      reply = await askKimi(messages);
      provider = 'kimi-chat';
    }

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
