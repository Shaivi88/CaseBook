// Serverless proxy: keeps the API key on the server and streams plain text back to the browser.
// Env: ANTHROPIC_API_KEY (required), ACCESS_CODE (optional), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MIN,
//      MODEL_QUICK, MODEL_DEFAULT, MODEL_COMPLEX, UPSTREAM_URL (for testing only).
const crypto = require('crypto');

const TIERS = {
  quick: process.env.MODEL_QUICK || 'claude-haiku-4-5-20251001',
  default: process.env.MODEL_DEFAULT || 'claude-sonnet-5-5',
  complex: process.env.MODEL_COMPLEX || 'claude-opus-5-5'
};
const MAX_TOKENS = { quick: 700, default: 4096, complex: 4096 };
const UPSTREAM = process.env.UPSTREAM_URL || 'https://api.anthropic.com/v1/messages';
const MAX_CHARS = 90000, MAX_TURNS = 30;
const LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 40;
const WINDOW_MS = (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 10) * 60 * 1000;

// Best-effort per-instance limiter. For hard limits add Vercel Firewall rate limiting (see README).
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  return list.length > LIMIT_MAX;
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const fail = (res, status, error) => { res.status(status).json({ error }); };

function buildMessages(input) {
  if (typeof input === 'string') return input.trim() ? [{ role: 'user', content: input }] : null;
  if (!Array.isArray(input) || !input.length || input.length > MAX_TURNS) return null;
  const out = [];
  for (const t of input) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string' || !t.content.trim()) return null;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += '\n\n' + t.content; else out.push({ role: t.role, content: t.content });
  }
  return out[0].role === 'user' && out[out.length - 1].role === 'user' ? out : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(res, 405, 'method_not_allowed'); }

  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return fail(res, 403, 'forbidden_origin'); } catch (e) { return fail(res, 403, 'forbidden_origin'); } }

  if (!process.env.ANTHROPIC_API_KEY) return fail(res, 503, 'not_configured');
  const code = process.env.ACCESS_CODE;
  if (code && !same(req.headers['x-access-code'] || '', code)) return fail(res, 401, 'access_code');

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (limited(ip)) return fail(res, 429, 'rate_limited');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return fail(res, 400, 'invalid_request');
  const tier = TIERS[body.tier] ? body.tier : 'default';
  const messages = buildMessages(body.input);
  if (!messages) return fail(res, 400, 'invalid_request');
  if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return fail(res, 413, 'prompt_too_large');

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: TIERS[tier], max_tokens: MAX_TOKENS[tier], stream: true, messages })
    });
  } catch (e) { return fail(res, 502, 'upstream_unreachable'); }

  if (!upstream.ok) {
    console.error('upstream status', upstream.status);
    if (upstream.status === 429) return fail(res, 429, 'rate_limited');
    if (upstream.status === 413) return fail(res, 413, 'prompt_too_large');
    if (upstream.status === 401 || upstream.status === 403) return fail(res, 503, 'not_configured');
    if (upstream.status === 400) return fail(res, 400, 'invalid_request');
    return fail(res, 502, 'upstream_error');
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  let buf = '';
  try {
    for await (const chunk of upstream.body) {
      buf += Buffer.from(chunk).toString('utf8');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const evt = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = evt.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let j; try { j = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') res.write(j.delta.text);
        else if (j.type === 'error') { console.error('upstream stream error'); buf = ''; break; }
      }
    }
  } catch (e) { /* client left or upstream dropped; end quietly */ }
  res.end();
};
