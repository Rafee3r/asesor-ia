import { createClient } from '@supabase/supabase-js';

let browserClient;
export function supabaseBrowser() {
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return browserClient;
}

export const ETAPAS = [
  'Nuevo', 'En conversacion', 'Calificado', 'Llamada agendada', 'Llamada hecha',
  'Firma agendada', 'Cerrado', 'No responde', 'Descartado',
];

export const ETIQUETA = { 'En conversacion': 'En conversación' };
export const etiqueta = (e) => ETIQUETA[e] || e;

export function horasDesde(fecha) {
  if (!fecha) return null;
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 36e5);
}

export function haceCuanto(fecha) {
  if (!fecha) return '';
  const min = Math.floor((Date.now() - new Date(fecha).getTime()) / 6e4);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export const pesos = (n) => (n || n === 0 ? '$' + Number(n).toLocaleString('es-CL') : '—');

export function soloDigitos(tel) {
  return String(tel || '').replace(/\D/g, '');
}

// Llama a la API del sistema con la sesion del usuario
export async function api(herramienta, args) {
  const sb = supabaseBrowser();
  const { data } = await sb.auth.getSession();
  const r = await fetch(`/api/v1/${herramienta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(args || {}),
  });
  const j = await r.json().catch(() => ({ ok: false, error: 'Respuesta inválida' }));
  if (!j.ok) throw new Error(j.error || 'Error');
  return j.data;
}
