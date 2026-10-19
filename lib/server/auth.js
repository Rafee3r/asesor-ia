import crypto from 'crypto';
import { db } from './db';

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Acepta: la clave de agentes (AGENT_API_KEY) o la sesion de un usuario logueado en la app
export async function autorizar(req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : req.headers.get('x-api-key');
  if (!token) return null;
  if (process.env.AGENT_API_KEY && iguales(token, process.env.AGENT_API_KEY)) return { tipo: 'agente' };
  const { data } = await db().auth.getUser(token);
  if (data?.user) return { tipo: 'usuario', id: data.user.id };
  return null;
}
