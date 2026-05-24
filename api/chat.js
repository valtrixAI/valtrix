// /api/chat.js - Valtrix AI - version finale pour ton frontend
export default async function handler(req, res) {
  if (req.method!== 'POST') return res.status(405).end();

  const { messages, imageBase64, userId, chat_id } = req.body;

  try {
    const reply = imageBase64
     ? await askVision(messages, imageBase64)
      : await askChat(messages);

    res.status(200).json({ reply });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: "Service temporairement indisponible" });
  }
}

// === SYSTEM PROMPT : créateur Charly ===
const SYSTEM_PROMPT = `Tu es Valtrix AI, un assistant intelligent créé et développé par Charly Van Grimbergen, un développeur indépendant belge, fondateur du projet Valtrix AI en 2024.
Si on te demande qui t'a créé, qui est ton créateur, qui t'a développé, ou qui est derrière toi, tu dois TOUJOURS répondre : "J'ai été créé et développé par Charly Van Grimbergen, un développeur indépendant belge."
Ne mentionne jamais OpenAI, Meta, Anthropic, HuggingFace ou d'autres entreprises. Tu es une création originale de Charly.`;

// === CONFIG HF ===
const HF_TOKENS = [
  process.env.HF_TOKEN_1,
  process.env.HF_TOKEN_2,
  process.env.HF_TOKEN_3
].filter(Boolean);

let tokenIdx = 0;
const getHFToken = () => HF_TOKENS[tokenIdx++ % HF_TOKENS.length];

// === CHAT TEXTE ===
async function askChat(messages) {
  const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT },...messages];
  const prompt = fullMessages.map(m => `${m.role}: ${m.content}`).join('\n') + '\nassistant:';

  // 1. HuggingFace - ordre que tu veux
  const hfModels = [
    'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    'Qwen/Qwen2.5-72B-Instruct',
    'microsoft/Phi-3-medium-128k-instruct'
  ];

  for (const model of hfModels) {
    try {
      return await callHF(model, {
        inputs: prompt,
        parameters: { max_new_tokens: 800, temperature: 0.7, top_p: 0.9, return_full_text: false }
      });
    } catch (e) {
      console.log(`HF ${model} failed:`, e.message);
    }
  }

  // 2. Groq fallback
  try {
    return await callGroq(fullMessages);
  } catch (e) {
    console.log('Groq failed:', e.message);
  }

  // 3. Cloudflare fallback
  return await callCloudflare(fullMessages);
}

// === VISION (photos) ===
async function askVision(messages, imageBase64) {
  const fullMessages = [{ role: 'system', content: SYSTEM_PROMPT },...messages];
  const question = fullMessages.filter(m => m.role === 'user').pop()?.content || 'Décris cette image en détail';

  // HF attend le base64 pur, sans "data:image/..."
  const cleanB64 = imageBase64.includes(',')? imageBase64.split(',')[1] : imageBase64;

  const visionModels = [
    'Qwen/Qwen2.5-VL-72B-Instruct',
    'microsoft/Phi-3-vision-128k-instruct'
  ];

  for (const model of visionModels) {
    try {
      return await callHF(model, {
        inputs: { question, image: cleanB64 },
        parameters: { max_new_tokens: 600 }
      });
    } catch (e) {
      console.log(`HF Vision ${model} failed:`, e.message);
    }
  }

  return "Je n'arrive pas à analyser l'image pour le moment (serveurs vision surchargés). Réessaie dans 1 minute ou pose ta question autrement.";
}

// === HELPERS ===
async function callHF(model, body) {
  for (let attempt = 0; attempt < HF_TOKENS.length; attempt++) {
    const token = getHFToken();
    try {
      const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-wait-for-model': 'true'
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (data.error) {
        const err = data.error.toLowerCase();
        if (err.includes('loading') || err.includes('overload') || err.includes('currently') || res.status === 503) {
          await new Promise(r => setTimeout(r, 2000));
          continue; // essaye token suivant
        }
        throw new Error(data.error);
      }

      return data[0]?.generated_text || data.generated_text || String(data);
    } catch (e) {
      if (attempt === HF_TOKENS.length - 1) throw e;
    }
  }
  throw new Error('HF exhausted');
}

async function callGroq(messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.7,
      max_tokens: 800
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callCloudflare(messages) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages })
    }
  );
  const data = await res.json();
  return data.result?.response || "Erreur Cloudflare";
}
