// Servidor MCP (Streamable HTTP, sin estado) para que agentes como Claude o Grok operen el sistema.
import { autorizar } from '../../../lib/server/auth';
import { TOOLS, ejecutar } from '../../../lib/server/tools';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const VERSIONES = ['2025-06-18', '2025-03-26', '2024-11-05'];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

async function atender(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (method === 'initialize') {
    const pedida = params?.protocolVersion;
    return ok({
      protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'asesor-ia-isapre', version: '0.1.0' },
      instructions: 'Sistema de asesoría de isapres: contactos de WhatsApp, Instagram y Messenger, perfiles completados por IA, llamadas del agente de voz y métricas por anuncio. La meta es cerrar cada cliente; respeta opt_out y la ventana de 24 h de Meta.',
    });
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') {
    return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    try {
      const data = await ejecutar(params?.name, params?.arguments || {});
      return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
    } catch (e) {
      return ok({ content: [{ type: 'text', text: String(e.message || e) }], isError: true });
    }
  }
  if (id === undefined) return null; // notificaciones: sin respuesta
  return err(-32601, 'Método no soportado: ' + method);
}

export async function POST(req) {
  if (!(await autorizar(req))) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'no autorizado' } }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }, 400); }

  if (Array.isArray(body)) {
    const res = (await Promise.all(body.map(atender))).filter(Boolean);
    return res.length ? json(res) : new Response(null, { status: 202 });
  }
  const res = await atender(body);
  return res ? json(res) : new Response(null, { status: 202 });
}

export async function GET() {
  return new Response('Usa POST (MCP Streamable HTTP)', { status: 405, headers: { Allow: 'POST' } });
}
