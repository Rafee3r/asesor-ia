import { NextResponse } from 'next/server';
import { autorizar } from '../../../../lib/server/auth';
import * as lab from '../../../../lib/server/lab';
import { leerAjuste, guardarAjuste, borrarAjuste, versiones } from '../../../../lib/server/settings';
import { CLAVE_CHAT, CLAVE_VOZ, guionChatPorDefecto, guionVozPorDefecto } from '../../../../lib/server/prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CLAVES = { chat: CLAVE_CHAT, voz: CLAVE_VOZ };
const DEFECTO = { chat: guionChatPorDefecto, voz: guionVozPorDefecto };

async function accion(nombre, a) {
  switch (nombre) {
    case 'personas':
      return lab.PERSONAS;
    case 'prompts': {
      const [chat, voz] = await Promise.all([leerAjuste(CLAVE_CHAT), leerAjuste(CLAVE_VOZ)]);
      return {
        chat: { activo: chat || guionChatPorDefecto(), personalizado: !!chat, defecto: guionChatPorDefecto() },
        voz: { activo: voz || guionVozPorDefecto(), personalizado: !!voz, defecto: guionVozPorDefecto() },
      };
    }
    case 'guardar_prompt': {
      if (!CLAVES[a.tipo]) throw new Error('tipo debe ser chat o voz');
      if (!a.guion || a.guion.length < 50) throw new Error('El guion está vacío o muy corto');
      await guardarAjuste(CLAVES[a.tipo], a.guion, a.nota);
      return { guardado: true };
    }
    case 'restaurar_prompt': {
      if (!CLAVES[a.tipo]) throw new Error('tipo debe ser chat o voz');
      await borrarAjuste(CLAVES[a.tipo]);
      return { guion: DEFECTO[a.tipo]() };
    }
    case 'versiones':
      return versiones(CLAVES[a.tipo] || CLAVE_CHAT);
    case 'turno_asesor':
      return lab.turnoAsesor(a);
    case 'turno_cliente':
      return lab.turnoCliente(a);
    case 'evaluar':
      return lab.evaluar(a);
    case 'historial':
      return lab.historialRuns();
    case 'prompt_voz_prueba':
      return { instrucciones: lab.promptVozDePrueba(a.guion, a.perfil) };
    case 'voz_token': {
      const r = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.XAI_API_KEY}` },
        body: JSON.stringify({ expires_after: { seconds: 300 } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`xAI ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
      const token = j.value || j.client_secret?.value || j.token || j.secret;
      if (!token) throw new Error('xAI no devolvió token: ' + JSON.stringify(j).slice(0, 200));
      return { token };
    }
    default:
      throw new Error('Acción no existe: ' + nombre);
  }
}

export async function POST(req, { params }) {
  if (!(await autorizar(req))) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 });
  const a = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ ok: true, data: await accion(params.accion, a) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e) }, { status: 400 });
  }
}
