// Serverless proxy: keeps the API key on the server and streams plain text back to the browser.
// Env: GROQ_API_KEY (required), ACCESS_CODE (optional), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MIN,
//      MODEL_QUICK, MODEL_DEFAULT, MODEL_COMPLEX
import Groq from 'groq-sdk';
import { createHash, timingSafeEqual } from 'crypto';

const TIERS = {
  quick:   process.env.MODEL_QUICK   || 'llama-3.1-8b-instant',
  default: process.env.MODEL_DEFAULT || 'openai/gpt-oss-20b',
  complex: process.env.MODEL_COMPLEX || 'openai/gpt-oss-20b',
};
const MAX_TOKENS = { quick: 700, default: 4096, complex: 4096 };
const MAX_CHARS = 90000, MAX_TURNS = 30;
const LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 40;
const WINDOW_MS = (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 10) * 60 * 1000;

// Instantiate once at module level, not per request
const groq = new Groq();

// Best-effort per-instance limiter. For hard limits add Vercel Firewall rate limiting (see README).
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  return list.length > LIMIT_MAX;
}

const sha  = s    => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));
const fail = (res, status, error) => res.status(status).json({ error });

function buildMessages(input) {
  if (typeof input === 'string') return input.trim() ? [{ role: 'user', content: input }] : null;
  if (!Array.isArray(input) || !input.length || input.length > MAX_TURNS) return null;
  const out = [];
  for (const t of input) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string' || !t.content.trim()) return null;
    const last = out.at(-1);
    if (last?.role === t.role) last.content += '\n\n' + t.content;
    else out.push({ role: t.role, content: t.content });
  }
  return out[0].role === 'user' && out.at(-1).role === 'user' ? out : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'method_not_allowed');
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return fail(res, 403, 'forbidden_origin');
    } catch {
      return fail(res, 403, 'forbidden_origin');
    }
  }

  if (!process.env.GROQ_API_KEY) return fail(res, 503, 'not_configured');

  const code = process.env.ACCESS_CODE;
  if (code && !same(req.headers['x-access-code'] || '', code)) return fail(res, 401, 'access_code');

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
  if (limited(ip)) return fail(res, 429, 'rate_limited');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') return fail(res, 400, 'invalid_request');

  const tier     = TIERS[body.tier] ? body.tier : 'default';
  const messages = buildMessages(body.input);
  if (!messages) return fail(res, 400, 'invalid_request');
  if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return fail(res, 413, 'prompt_too_large');

  let stream;
  try {
    stream = await groq.chat.completions.create({
      model:      TIERS[tier],
      max_tokens: MAX_TOKENS[tier],
      messages,
      stream:     true,
    });
  } catch (e) {
    console.error('groq create error:', e.constructor?.name, e.status, e.message);
    if (e.status === 429) return fail(res, 429, 'rate_limited');
    if (e.status === 401 || e.status === 403) return fail(res, 503, 'not_configured');
    if (e.status === 400 || e.status === 422) return fail(res, 400, 'invalid_request');
    return fail(res, 502, 'upstream_unreachable');
  }

  // Use stream.controller.abort() — the SDK-native way to cancel
  res.on('close', () => stream.controller.abort());

  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  try {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) res.write(text);
    }
  } catch (e) {
    if (!(e instanceof Groq.APIUserAbortError)) {
      console.error('stream error:', e.message);
    }
  }

  res.end();
}
