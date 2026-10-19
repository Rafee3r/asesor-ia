import { NextResponse } from 'next/server';
import { db } from '../../../lib/server/db';
import { registrarEvento } from '../../../lib/server/core';

export const dynamic = 'force-dynamic';

// Leads de formularios de Meta (via Make): POST con header x-api-key = AGENT_API_KEY
export async function POST(req) {
  if (!process.env.AGENT_API_KEY || req.headers.get('x-api-key') !== process.env.AGENT_API_KEY) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }
  const b = await req.json().catch(() => ({}));
  const num = (v) => { const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
  let tel = String(b.telefono || '').replace(/\D/g, '') || null;
  if (tel && tel.length === 9 && tel.startsWith('9')) tel = '56' + tel; // formato WhatsApp Chile

  const { data: admin } = await db().from('profiles').select('id').eq('rol', 'admin').order('created_at').limit(1);
  const fila = {
    canal_origen: 'formulario',
    nombre: b.nombre || null,
    telefono: tel,
    wa_id: tel, // si despues escribe por WhatsApp, se une a esta misma ficha
    email: b.email || null,
    edad: num(b.edad),
    renta: num(b.renta),
    cargas: num(b.cargas),
    comuna: b.comuna || null,
    prevision_actual: b.isapre_actual || null,
    horario_llamada: b.horario_llamada || null,
    ad_id: b.ad_id || null,
    meta_lead_id: b.meta_lead_id || null,
    consentimiento: true,
    asignado_a: admin?.[0]?.id || null,
    last_message_at: new Date().toISOString(),
  };
  const { data, error } = await db().from('contacts').upsert(fila, { onConflict: 'meta_lead_id', ignoreDuplicates: true }).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data?.[0]) await registrarEvento(data[0], 'LeadSubmitted', 'whatsapp');
  return NextResponse.json({ ok: true });
}
