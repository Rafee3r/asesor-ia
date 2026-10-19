import { createClient } from '@supabase/supabase-js';

// Cliente con service role: solo para codigo de servidor (webhooks, API, MCP).
let admin;
export function db() {
  if (!admin) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return admin;
}

export const ETAPAS = [
  'Nuevo', 'En conversacion', 'Calificado', 'Llamada agendada', 'Llamada hecha',
  'Firma agendada', 'Cerrado', 'No responde', 'Descartado',
];

// Campos del perfil que el bot puede completar
export const CAMPOS_PERFIL = [
  'nombre', 'telefono', 'email', 'edad', 'renta', 'cargas', 'edades_cargas', 'comuna', 'region',
  'prevision_actual', 'plan_actual', 'costo_plan_actual', 'clinica_preferida', 'necesidades',
  'preexistencias_mencionadas', 'horario_llamada',
];

const NUMERICOS = new Set(['edad', 'renta', 'cargas', 'costo_plan_actual']);

// Limpia lo que devuelve la IA antes de guardarlo
export function limpiarPerfil(p = {}) {
  const out = {};
  for (const k of CAMPOS_PERFIL) {
    let v = p[k];
    if (v === undefined || v === null || v === '') continue;
    if (NUMERICOS.has(k)) {
      const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(n)) continue;
      v = n;
    } else if (k === 'preexistencias_mencionadas') {
      v = v === true || v === 'true' || v === 'si' || v === 'sí';
    } else {
      v = String(v).slice(0, 500);
    }
    out[k] = v;
  }
  return out;
}

export function soloDigitos(tel) {
  return String(tel || '').replace(/\D/g, '');
}
