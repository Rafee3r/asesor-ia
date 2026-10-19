// Cliente minimo de la API de xAI (compatible con el formato de OpenAI)
export async function grokJSON(system, messages) {
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || 'grok-4-1-fast',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`xAI ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const txt = data?.choices?.[0]?.message?.content || '';
  return parseJSON(txt);
}

// Tolera respuestas con texto alrededor del JSON
export function parseJSON(txt) {
  try { return JSON.parse(txt); } catch {}
  const i = txt.indexOf('{');
  const j = txt.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(txt.slice(i, j + 1)); } catch {}
  }
  throw new Error('La IA no devolvio JSON valido');
}
