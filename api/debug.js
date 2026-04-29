export default function handler(req, res) {
  res.status(200).json({
    has_URL: !!process.env.SUPABASE_URL,
    url_start: process.env.SUPABASE_URL?.substring(0, 20) || null,
    has_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    key_length: process.env.SUPABASE_SERVICE_ROLE_KEY?.length || 0,
    has_GROQ: !!process.env.GROQ_API_KEY
  });
}
