// Gemini API client — text + photo understanding only (works on the free tier).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const clean = (m) => String(m || '').trim().replace(/^models\//, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendly(status, text) {
  let msg = text;
  try { msg = JSON.parse(text).error?.message || text; } catch {}
  if (status === 400 && /API key not valid/i.test(msg)) return 'Your API key is not valid. Check it in Settings.';
  if (status === 404) return 'Model not found. Open Settings and tap "Test key" — it picks a working model for you.';
  if (status === 429) return 'Gemini free limit hit for the moment (it has per-minute and per-day limits). Wait a minute and try again.';
  if (status === 503) return 'Gemini is busy right now. Try again in a moment.';
  return `Gemini error ${status}: ${String(msg).slice(0, 240)}`;
}

/** returns { text, sources:[{title,uri}] } */
export async function generate({ apiKey, model, parts, json = false, search = false }) {
  if (!apiKey) throw new Error('Add your Gemini API key in Settings first.');
  const body = { contents: [{ role: 'user', parts }] };
  if (search) body.tools = [{ google_search: {} }];
  else if (json) body.generationConfig = { responseMimeType: 'application/json' };

  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    let res;
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(clean(model))}:generateContent`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      clearTimeout(timer);
      last = new Error(e.name === 'AbortError' ? 'Gemini took too long to answer. Try again.' : 'Network error — check your connection.');
      if (e.name === 'AbortError') throw last;
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      clearTimeout(timer);
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      if (!text) throw new Error(`Gemini returned nothing (${cand?.finishReason || data.promptFeedback?.blockReason || 'empty'}). Try again.`);
      const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter(Boolean).map((w) => ({ title: w.title, uri: w.uri }));
      return { text, sources };
    }
    clearTimeout(timer);
    const t = await res.text();
    if (search && res.status === 400) { delete body.tools; search = false; if (json) body.generationConfig = { responseMimeType: 'application/json' }; continue; }
    last = new Error(friendly(res.status, t));
    if (res.status === 503 || res.status >= 500) { await sleep(2500 * (attempt + 1)); continue; }
    throw last;
  }
  throw last;
}

export async function listModels(apiKey) {
  const res = await fetch(`${BASE}/models?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw new Error(friendly(res.status, await res.text()));
  const data = await res.json();
  return (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => clean(m.name));
}

const PREF = ['gemini-flash-latest', 'gemini-3.1-flash', 'gemini-3-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
export function pickModel(names) {
  const ok = names.filter((n) => !/image|banana|tts|live|audio|embedding|veo|imagen|robotics|computer/i.test(n));
  return { best: PREF.find((m) => ok.includes(m)) || ok.find((n) => /flash/i.test(n) && !/lite/i.test(n)) || ok[0], options: ok };
}

export function parseJSON(text) {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('Could not read the AI answer. Try again.');
}
