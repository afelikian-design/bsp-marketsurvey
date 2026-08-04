/* =============================================================================
   /api/insights — turns a market-survey brief into observation bullets.

   The prompt lives here rather than in the browser so this endpoint can't be
   repurposed as a general-purpose proxy for the API key: the only thing a
   caller controls is the brief, and that gets validated and size-capped first.
   ========================================================================== */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_BRIEF_BYTES = 60000;

const PROMPT = brief => `You are a senior multifamily asset manager reading a market survey for an institutional owner. JSON summary from an ApartmentIQ export:

${JSON.stringify(brief)}

Return 5-7 very short bullets on how the subject is positioned. Rules:
- Each bullet is ONE sentence, 18 words maximum. Clipped and scannable, not prose. Drop articles where it still reads cleanly.
- Give each a 1-3 word tag: e.g. Pricing gap, Concessions, Net PSF, Vintage, Velocity, Exposure, Risk, Action.
- Always separate asking rent from effective rent and attribute the gap to concessions.
- Where the subject looks weak, say whether it reads as a pricing problem or a product/vintage problem.
- Name a specific comp when it carries the point.
- Conservative institutional tone. No hype, no filler, no restating the obvious.
Return ONLY a JSON array of objects shaped {"tag":"...","text":"..."}. No markdown, no code fences.`;

const json = (statusCode, body) =>
  new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(500, { error: 'ANTHROPIC_API_KEY is not set on this site' });

  let brief;
  try {
    brief = (await req.json()).brief;
  } catch (e) {
    return json(400, { error: 'Malformed JSON body' });
  }
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    return json(400, { error: 'Expected a "brief" object' });
  }

  const serialized = JSON.stringify(brief);
  if (serialized.length > MAX_BRIEF_BYTES) {
    return json(413, { error: 'Brief too large' });
  }
  // Shape check — a real brief always carries these.
  if (!brief.subject || !brief.subjectPricing || !brief.compSet) {
    return json(400, { error: 'Brief is missing required fields' });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: 'user', content: PROMPT(brief) }]
      })
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('Anthropic API error', res.status, detail.slice(0, 500));
      return json(502, { error: 'Upstream error ' + res.status });
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter(c => c.type === 'text').map(c => c.text).join('\n')
      .replace(/```json|```/g, '').trim();

    let bullets;
    try {
      bullets = JSON.parse(text);
    } catch (e) {
      const m = text.match(/\[[\s\S]*\]/);          // salvage a stray wrapper
      if (!m) throw new Error('Model did not return JSON');
      bullets = JSON.parse(m[0]);
    }
    if (!Array.isArray(bullets) || !bullets.length) throw new Error('Empty result');

    bullets = bullets
      .map(b => typeof b === 'string'
        ? { tag: '', text: b }
        : { tag: String(b.tag || '').slice(0, 40), text: String(b.text || '').slice(0, 400) })
      .filter(b => b.text)
      .slice(0, 8);

    if (!bullets.length) throw new Error('Empty result');
    return json(200, { bullets });
  } catch (e) {
    console.error('insights failed:', e);
    return json(502, { error: e.message || 'Insights unavailable' });
  }
}
