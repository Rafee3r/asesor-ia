import { NextResponse } from 'next/server';
import { firmaValida } from '../../../../lib/server/meta';
import { procesarEntrante } from '../../../../lib/server/core';
import { normalizar } from '../../../../lib/server/normalizar';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Meta verifica el webhook con un GET al configurarlo
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === process.env.META_VERIFY_TOKEN) {
    return new Response(p.get('hub.challenge'), { status: 200 });
  }
  return new Response('token invalido', { status: 403 });
}

export async function POST(req) {
  const raw = await req.text();
  if (!firmaValida(raw, req.headers.get('x-hub-signature-256'))) {
    return new Response('firma invalida', { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response('json invalido', { status: 400 }); }

  const resultados = [];
  for (const m of normalizar(body)) {
    try {
      resultados.push(await procesarEntrante(m));
    } catch (e) {
      console.error('Error procesando mensaje', m.metaMessageId, e);
      resultados.push({ error: String(e.message || e) });
    }
  }
  // Siempre 200 para que Meta no reintente en bucle; los errores quedan en los logs
  return NextResponse.json({ ok: true, procesados: resultados.length, resultados });
}
