import crypto from 'crypto';
import { db } from './db';

// Cache corta para no consultar la base en cada mensaje
const cache = new Map();
const TTL = 30 * 1000;

export async function leerAjuste(key) {
  const c = cache.get(key);
  if (c && Date.now() - c.t < TTL) return c.v;
  const { data, error } = await db().from('settings').select('value').eq('key', key).maybeSingle();
  const v = error ? null : data?.value ?? null; // si la tabla no existe todavia, se usa el prompt por defecto
  cache.set(key, { v, t: Date.now() });
  return v;
}

export async function guardarAjuste(key, value, nota) {
  const { error } = await db().from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await db().from('prompt_versions').insert({ key, value, nota: nota || null });
  cache.delete(key);
}

export async function borrarAjuste(key) {
  await db().from('settings').delete().eq('key', key);
  cache.delete(key);
}

export async function versiones(key, limite = 20) {
  const { data } = await db().from('prompt_versions').select('id,created_at,nota,value').eq('key', key)
    .order('created_at', { ascending: false }).limit(limite);
  return data || [];
}

export const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
