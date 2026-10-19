import { NextResponse } from 'next/server';
import { autorizar } from '../../../lib/server/auth';
import { TOOLS } from '../../../lib/server/tools';

export const dynamic = 'force-dynamic';

// GET /api/v1 lista las herramientas disponibles y sus parametros
export async function GET(req) {
  if (!(await autorizar(req))) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  return NextResponse.json({
    herramientas: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, url: `/api/v1/${name}` })),
  });
}
