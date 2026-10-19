import { NextResponse } from 'next/server';
import { autorizar } from '../../../../lib/server/auth';
import { ejecutar } from '../../../../lib/server/tools';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// POST /api/v1/<herramienta>  con body JSON = argumentos
export async function POST(req, { params }) {
  if (!(await autorizar(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  const args = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ ok: true, data: await ejecutar(params.tool, args) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
